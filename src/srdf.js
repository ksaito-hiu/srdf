// Solid上のTurtleファイルをRDFのデーターベースとして
// 手軽に使うためのJavaScriptモジュール。

import { $rdf } from 'rdflib';
//import {$rdf} from './rdflib.min.js';
//import {solidAuthFetcher} from './solid-auth-fetcher.bundle.js';

// urlで指定されたTurtleファイルやRDFaが上手こまれたWebページを
// 読み来んで，そこに含まれるセマンティックウェブのデーターが
// 保存されたインメモリのRDFデーターベースを返す。
// Solid上のTurtueファイル
// ただしFethcerとUpdateManagerの機能により，インメモリの
// データーベースの変更をSolidサーバーに反映させる機能も持つ。

async function srdf_connect(url,useUpdater) {
  try {
    const srdf = {};
    srdf.baseURL = url;
    srdf.store = $rdf.graph();
    srdf.fetcher = $rdf.fetcher(srdf.store,{fetch: solidAuthFetcher.fetch.bind(solidAuthFetcher)});
    await srdf.fetcher.load(url);
    srdf.updater = null;
    if (useUpdater===true)
      srdf.updater = new $rdf.UpdateManager(srdf.store);
    srdf.rules = [];

    // DB内のデーターをTurtleの文字列にする
    // (色々なメタデータは含めないで)
    srdf.serialize = function(baseURL) {
      const format = "text/turtle";
      let doc;
      if (!!baseURL)
        doc = $rdf.sym(baseURL);
      else
        doc = $rdf.sym(srdf.baseURL);
      const aclDocURI = "dummy"; // nullじゃだめだった
      const res1 = $rdf.serialize(doc,srdf.store,aclDocURI,format);
      return unescapeUnicode(res1);
    }

    // 色々カスタムしてDB内のデーターを文字列化する
    // formatは"text/turtle"とか，"application/rdf+xml"とか。
    // fromDocURLはステートメントの由来を指定するものだけど，
    // nullにしておけば全部出てくる。fromDocURLをnullにすると
    // 色々メタデーターとかも出てくる。
    srdf.serializeCustom = function(format,fromDocURL) {
      format = format || "text/turtle";
      let doc;
      if (fromDocURL) {
        doc = $rdf.sym(fromDocURL);
      } else {
        doc = null;
      }
      const aclDocURI = "dummy"; // nullじゃだめだった
      const res1 = $rdf.serialize(doc,srdf.store,aclDocURI,format);
      return unescapeUnicode(res1);
    }

    // Turtleの文字列で与えられた情報をDBに追加するメソッド
    srdf.addTurtle = async function(turtle,fromURL) {
      fromURL = fromURL || srdf.baseURL;
      const from = $rdf.sym(fromURL);
      const store2 = $rdf.graph();
      $rdf.parse(turtle,store2,from.uri,'text/turtle');
      const ins = store2.statementsMatching(null,null,null,from);
      return new Promise((resolve,reject)=> {
        if (srdf.updater) {
          srdf.updater.update([],ins,(uri,ok,message) => {
            if (ok) resolve();
            else reject(message);
          });
        } else {
          srdf.store.addAll(ins);
          resolve();
        }
      });
    };

    // rdflibの方法で三つ組を追加
    // wは三つ組の情報源となるリソースで必須
    srdf.add = async function(s,v,o,w) {
      if (!w) {
        w = $rdf.sym(srdf.baseURL);
      }
      const ins = [];
      ins.push(new $rdf.Statement(s,v,o,w));
      return new Promise((resolve,reject)=> {
        if (srdf.updater) {
          srdf.updater.update([],ins,(uri,ok,message) => {
            if (ok) resolve();
            else reject(message);
          });
        } else {
          srdf.store.add(s,v,o,w);
          resolve();
        }
      });
    };

    // rdflibの方法で三つ組を多数追加
    // 三つ組の配列をわたしてあげるようにする。
    srdf.addAll = async function(ins) {
      return new Promise((resolve,reject)=> {
        for (let i=0;i<ins.length;i++) {
          if (!(ins[i].graph)) {
            ins[i].graph = $rdf.sym(srdf.baseURL);
          }
        }
        if (srdf.updater) {
          srdf.updater.update([],ins,(uri,ok,message) => {
            if (ok) resolve();
            else reject(message);
          });
        } else {
          srdf.store.addAll(ins);
          resolve();
        }
      });
    };

    // rdflibの方法で三つ組を検索
    srdf.search = async function(s,v,o,w) {
      return srdf.store.match(s,v,o,w);
    };

    // SPARQLでデーターを検索するためのメソッド
    srdf.sparqlSelect = async function(query) {
      return new Promise(async (resolve,reject)=>{
        try {
          // 以下の第2引数のtrueはLink followingの機能をOFFにする。
          const q = $rdf.SPARQLToQuery(query,true,srdf.store);
          const results = [];
          await srdf.store.query(q,res=>{
            if (typeof(res)==="undefined") reject("No results.");
            else {
              const res2 = {};
              for (const r in res)
                res2[r] = res[r].value;
              results.push(res2);
              results.vars = [];
              for (let i=0;i<q.vars.length;i++)  {
                results.vars[i] = "?"+q.vars[i].value;
              }
            }
            // 以下のnullはLink followingの機能をOFFにする。
          },null,()=>{resolve(results);})
        } catch(err) {
          reject(err);
        }
      });
    };

    // statementMatchingの機能で検索するためのメソッド
    srdf.statementsMatching = function(s,v,o,w) {
      return srdf.store.statementsMatching(s,v,o,w);
    };

    // データーベース内のデーターの削除
    // 2020,12/08: updater使う方，現在なぜか動作しないみたい。
    srdf.delete = async function(s,v,o,w) {
      return new Promise((resolve,reject)=> {
        if (srdf.updater) {
          const del = srdf.store.statementsMatching(s,v,o,w);
          srdf.updater.update(del,[],(uri,ok,message) => {
            if (ok) resolve();
            else reject(message);
          });
        } else {
          srdf.store.removeMatches(s,v,o,w);
          resolve();
        }
      });
    };

    // データーをwebに書き戻す
    srdf.putBack = async function(uri,options) {
      await srdf.fetcher.putBack(uri,options);
    };

    // ルール関数をセットする
    srdf.addRule = async function(rule) {
      srdf.rules.push(rule);
    };

    // 推論ループの最大回数
    const MAX_INFER = 100;
    // 設定されたルールを用いて推論をする
    // 返り値は推論が収束した時true，しなかった時false。
    srdf.infer = async function() {
      let fin;
      for (let i=0;i<MAX_INFER;i++) {
        fin = true;
        for (let r of srdf.rules)
          fin = fin && await r(srdf);
        if (fin === true)
          return true;
      }
      return false;
    };

    return srdf;
  } catch(err) {
    console.log(err);
    return null;
  }
}

// 空のTurtleのファイルを作成して，なおかつ
// それに接続されたインメモリRDFデターベースを返す。
// 現在の実装では，すでにファイルがある時には上書きして
// 内容を全消去するので注意。
//(Turtleファイルが置かれるフォルダは先に作っとけ)
async function srdf_create(url,useUpdater) {
  const store = $rdf.graph();
  const doc = $rdf.sym(url);

  const updater = new $rdf.UpdateManager(store);
  const data = ``

  await new Promise((resolve,reject)=>{
    updater.put(doc,data,"text/turtle", (uri, ok, message, response) => {
      if (ok) resolve('created');
      else reject(message)
    });
  });

  return srdf_connect(url,useUpdater);
}

async function srdf_remove(url) {
  const store = $rdf.graph();
  const doc = $rdf.sym(url);
  const fetcher = new $rdf.Fetcher(store);

  const e = await store.fetcher.webOperation('DELETE', doc.uri);
  console.log(e);
}

// URLの文字列からprefix部分を予想して，そのprefixを
// 除外した文字列を返す。(識別子としてのURLの最後の
// 一番具体的な部分だけ取り出す。)
function url_tail(url) {
  if (!url) {
    return "?empty?";
  } else if (url.lastIndexOf('#')!=-1) {
    return url.substring(url.lastIndexOf('#')+1);
  } else if (url.lastIndexOf('/')!=-1) {
    return url.substring(url.lastIndexOf('/')+1);
  } else {
    return url;
  }
}

// エスケープされたUnicode文字をアンエスケープする関数
function unescapeUnicode(string) {
  return string.replace(/\\u([a-fA-F0-9]{4})/g, function(matchedString, group1) {
    return String.fromCharCode(parseInt(group1, 16));
  });
}

// ###############################################################
// # 以下，srdfのUI(主にログイン，ログアウト)の機能のためのコード #
// ###############################################################
// 以下，Solidのログイン関係のJavaScript。これに関する詳しい説明は
// memo.mmを参照。

// UIをログイン状態にする．
// (CSSのclassがsrdf_logged_inの物をdisplay: block;にして
//  srdf_logged_outの物をdisplay: none;にして，srdf_login_status
//  の物のtextContentにloginの状態を書き込む)
function srdf_ui_logged_in() {
  for (let e of document.querySelectorAll(".srdf_logged_in")) {
    e.style.display = "block";
  }
  for (let e of document.querySelectorAll(".srdf_logged_out")) {
    e.style.display = "none";
  }
  solidAuthFetcher.getSession().then((session) => {
    if (session && !!session.loggedIn) {
      for (let e of document.querySelectorAll(".srdf_login_status")) {
        e.textContent = 'You are logged in as <'+(session && session.webId)+'>.';
      }
    }
  });
}

export { srdf_connect, srdf_create, srdf_remove, url_tail };
