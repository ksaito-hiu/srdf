// jr_parser.js Varsion 20211126
// (c) 2021 Kenji Saito
//
// 演算子順位構文解析を実装したparser.mjsを使って
// Jenaのルールのパーサーを作る
// 実際には演算子順位構文解析は使わないけど、
// parser.mjsの読み込んでいる字句解析(tokenizer.mjs)
// やパーサーコンビネーターの関数を使用する。
//
// とりあえずJenaのルールの文法を完全にコピーするんじゃなく
// 簡単に実装することを優先。でも、サブセットにはなるように
// しておきたい。
//
// 後ろ向き推論のルールは実装しない。
// 簡単のため@prefixの文は一番最初にまとめてしか書けない
// ことにする。
//
// ここで一つ問題発覚。URI特にURLのパースでは
// https://wwwのように途中に「//」が入るけど、
// parser.mjsを使うユーザーが1行コメントの設定を
// 変更する機能を作って'//'をコメントとして処理
// しないようにするとか、行頭の'#'のみを1行コメント
// の開始文字列とできるような機能、もしくは
// `://`を区切り文字列として指定して、tokenizerを
// 修正して、1行コメントより先に区切り文字の
// トークン処理をするように書き換えないとダメかも
// しれない。ここでは1行コメント文字を「*」ということ
// にしてごまかす。
//
// 2021,11/28: ただのパーサーの域を越えて、sdbに組み込む
// ことを前提にしたプログラムを追加してしまった。Tripleクラスと
// BuiltinクラスのtoTurtleString()、exec(rdf,store,env,prefixes)と、
// Termクラスのeval(env,prefixes)がそれ。
// ここらへんを上手く動かすためには、ルールの条件部(LHS)に変数の
// 書き換えを行うbuiltinを入れてはいけないとか、の制約が出てくるし、
// builtinの全てに対応するのも無理なので、やめときたい所だけど、
// 早急にsdbに組み込みたいのでやってしまっている。どうしても
// notEqualとstrConcatに対応させたいところ。
//
// 2022,05/09: とりあえず良く使うビルトインはBuiltinクラスの
// execメソッドに実装してしまった。さらにcustom_processorという
// 関数を登録することができるようにして、ルールの中でcustom(???)という
// ビルトインが来た時にその関数が呼び出される仕組みを作った。
// つまりルールのビルトインを後付けで拡張できるようにした。
//
// あと気がついたこと。ルールの条件部に変数を含まない3つ組が
// あると上手くSPARQLが組めなくて動作しない。結論部が2回
// 実行されることがあるのは何故か？

import { python_heredoc, shell_heredoc, javascript_heredoc, error, symbol, getSymbol,
         punctuator, operator, reserved, set_c1_start_str, set_cb_start_str,
         set_cb_end_str, infix, infixr, prefix, postfix, ternary,
         prefix_bracket_op, infix_bracket_op,
         expression, defNTS, NTS, getNTS, err, ok, fail, str, type, or, seq,
         many, many1, sepBy, sepBy1, opt, prepare, modify, notFollowedBy,
         lookAhead, omit, exp,
         parse, printTree, traverse, new_env } from './parser.js';

// 1行コメント開始文字列を「*」にする
// つまりJenaのルールの記述の中に「*」が入ってたら死亡する
set_c1_start_str('*');

/*
 ****************************************
 * 区切り子                             
 ****************************************
 */
// 本当は演算子や予約語扱いの方が良い物が
// あるけど、簡単のためこうしておく
punctuator("@prefix");
punctuator("->");
punctuator(".");
punctuator("(");
punctuator(")");
punctuator("<");
punctuator(">");
punctuator(":");
punctuator("?");
punctuator("#");
punctuator("/");

/*
 ****************************************
 * 予約語
 ****************************************
 */
// 本当は以下のように@prefixぐらいは予約語に
// しようかと思ったけど、やめとく
//reserved("@prefix");

/*
 ****************************************
 * 演算子順位構文解析のための演算子の宣言
 ****************************************
 */
// たぶん出番は無いけど、例だけ書いとく
//infix("+",  50, "加算演算子");
//infix("-",  50, "減算演算子");
//infix("*",  60, "乗算演算子");
//infix("/",  60, "除算演算子");
//infix("%",  60, "剰余演算子");

/*
 *******************************************************
 * パーサーコンビネーターで再帰下降構文解析をする。
 * 以下のページに本家の文法あるけど、だいぶ無視。
 * https://jena.apache.org/documentation/inference/
 *******************************************************
 */
// 以下，文の非終端記号の定義
defNTS("Jenaのルール",seq(NTS("プレフィックス部"),
                          NTS("ルール部"),
                          omit(type("(end)"))));

// プレフィックス部
defNTS("プレフィックス部",many(NTS("プレフィックス宣言")));
defNTS("プレフィックス宣言",seq(str("@prefix"),
                                opt(type("id")),
                                str(":"),
                                NTS("<URI>"),
                                str(".")));
// "<URI>"は下の方で定義

// ルール部
defNTS("ルール部",many(NTS("ルール宣言")));
defNTS("ルール宣言",seq(NTS("条件部"),
                        str("->"),
                        NTS("実行部"),
                        str(".")));
defNTS("条件部",many1(or(NTS("三つ組"),NTS("ビルトイン"))));
defNTS("実行部",many1(or(NTS("三つ組"),NTS("ビルトイン"))));
defNTS("三つ組",seq(str("("),
                    NTS("項"),
                    NTS("項"),
                    NTS("項"),
                    str(")")));
defNTS("ビルトイン",seq(type("id"),
                        str("("),
                        many(NTS("項")),
                        str(")")));
defNTS("項",or(NTS("<URI>"),
               NTS("URIの省略形"),
               NTS("変数"),
               type("num"),
               type("str")));
defNTS("URIの省略形",seq(opt(type("id")),
                         str(":"),
                         type("id"))); // 2つ目のtype("id")はヤバイ
defNTS("<URI>",seq(str("<"),
                   parse_uri(),
                   str(">")));
// 以下URIをパースする関数。
// とりあえず'>'が見付かるまでtokenを消費して
// uriの文字列を作るだけ
function parse_uri() {
  return function(token) {
    const tree = { str: '', type: '#uri', kids: [] };
    while (token.str !== '>') {
      if (token.str === '(end)')
        return {ok:false,tree,token,errors:['URI解析中に入力が終了しました。']};
      tree.str += token.str;
      token = token.next;
    }
    return {ok:true,tree,token,errors:[]};
  }
}
// 変数
defNTS("変数",seq(str("?"),type("id")));

// 満を持して，構文解析をスタートさせる関数。
// 返り値はparser.jsのparse関数の返り値に、
// prefixes,rulesを追加した物
// {ok:成否, tree:木, token:次のトークン, errors:[エラーの配列]
//  prefixes:{'':'url1','pre2':'url2',・・・},
//  rules:[・・・]
//  }
function jr_parse(src) {
  // 構文解析実行
  const res = parse("Jenaのルール",src);

  // 結果が失敗だったら、データーをそのまま返す
  if (res.ok !== true)
    return res;

  // 以下構文解析結果からJenaのルールに関する情報を抽出して整理する
  // プレフィックスの情報抽出
  const prefixes = {};
  for (const p of res.tree.kids[0].kids) {
    const key=p.kids[1].kids[0]?p.kids[1].kids[0].str:"";
    const val=p.kids[3].kids[1].str;
    prefixes[key] = val;
  }
  // ルールの情報抽出
  const rules = [];
  for (const r of res.tree.kids[1].kids)
    rules.push(new Rule(r));

  // 構文解析結果に整理した情報を埋め込む
  res.prefixes = prefixes;
  res.rules = rules;
  
  return res;
}

// 三つ組の項(term)のクラス
class Term {
  // treeは構文解析結果の該当する部分
  constructor(tree) {
    if (tree.type === 'str') {
      this.type = 'str';
      this.notation = '"'+tree.str+'"';
      this.str = tree.str;
    } else if (tree.type === 'num') {
      this.type = 'num';
      this.notation = tree.str;
      this.num = Number(tree.str);
    } else if (tree.kids[0].nts_name === '<URI>') {
      this.type = 'URI';
      this.notation = '<'+tree.kids[0].kids[1].str+'>';
      this.uri = tree.kids[0].kids[1].str;
    } else if (tree.kids[0].nts_name === 'URIの省略形') {
      let pre;
      if (tree.kids[0].kids[0].kids.length===0)
        pre = '';
      else
        pre = tree.kids[0].kids[0].kids[0].str
      let local = tree.kids[0].kids[2].str;
      this.type = 'URIの省略形';
      this.notation = pre+':'+local;
      this.pre = pre;
      this.local = local;
    } else if (tree.kids[0].nts_name === '変数') {
      this.type = '変数';
      this.notation = '?'+tree.kids[0].kids[1].str;
      this.var = '?'+tree.kids[0].kids[1].str;
    } else {
      this.type = 'エラー';
      this.notation = 'エラー';
    }
  }

  toString() {
    return this.notation;
  }

  // この項が変数でvarsリストに入ってないならvarsに入れる。
  makeVarList(vars) {
    if (this.type==='変数')
      if (!vars.includes(this.notation))
        vars.push(this.notation);
  }

  eval(rdf,store,env,prefixes) {
    let ret = null;
    switch(this.type) {
    case 'str':
      ret = this.str;
      break;
    case 'num':
      ret = this.num;
      break;
    case 'URI':
      ret = rdf.sym(this.uri);
      break;
    case 'URIの省略形':
      ret = rdf.sym(prefixes[this.pre](this.local));
      break;
    case '変数':
      // 変数の中が何なのかの判別が適当
      const tmp = env[this.var];
      if (tmp && tmp.startsWith('http'))
        ret = rdf.sym(tmp);
      else
        ret = tmp;
      break;
    case 'エラー':
      ret = 'エラー';
      break;
    }
    return ret;
  }
}

// 三つ組のクラス
class Triple {
  // treeは構文解析結果の該当する部分
  constructor(tree) {
    this.res = new Term(tree.kids[1]);
    this.pro = new Term(tree.kids[2]);
    this.val = new Term(tree.kids[3]);
  }

  toString() {
    return '('+this.res.toString()+' '+this.pro.toString()+' '+this.val.toString()+')';
  }

  // 変数のリストvarsに入ってない変数を持っていたらvarsに入れる。
  makeVarList(vars) {
    this.res.makeVarList(vars);
    this.pro.makeVarList(vars);
    this.val.makeVarList(vars);
  }

  toTurtleString() {
    return this.res.toString()+' '+this.pro.toString()+' '+this.val.toString()+' .';
  }

  // 実行部の三つ組はstoreに追加されなければならないけど、
  // すでに追加済みだったら追加しない。返り値がtrueだったら
  // 追加したことを表し、falseだったら追加済みだったので追加
  // しなかったことを表す。
  async exec(rdf,store,env,prefixes) {
    const s = this.res.eval(rdf,store,env,prefixes);
    const p = this.pro.eval(rdf,store,env,prefixes);
    const o = this.val.eval(rdf,store,env,prefixes);
    const quads = store.match(s,p,o);
    if (quads.length!==0)
      return false;
    // 推論によって生成されたという意味でwを以下の値にしておく
    const w = rdf.sym("https://infer.org/");
    await store.add(s,p,o,w);
    return true;
  }
}

// ビルトインのクラス
class Builtin {
  // treeは構文解析結果の該当する部分
  constructor(tree) {
    // this.builtinはビルトインの名前
    this.builtin = tree.kids[0].str;
    this.terms = [];
    for (const t of tree.kids[2].kids)
      this.terms.push(new Term(t));
  }

  toString() {
    let s = this.builtin+'(';
    for (let i=0;i<this.terms.length;i++) {
      s += this.terms[i].toString();
      if (i!==(this.terms.length-1))
        s += ' ';
    }
    s += ')';
    return s;
  }

  // 変数のリストvarsに入ってない変数を持っていたらvarsに入れる
  // メソッドなんだけど、ビルトインの場合は入れたくないので、
  // なにもしない。
  makeVarList(vars) {
  }

  // もともと、このメソッドで作ったttl文字列をSPARQLに入れる目的で作ったんだけど、
  // rdflibのSPARQLが前よりも後退してるみたいで、FILTERが使えない。よってここでは
  // 無条件の空文字列を返すだけにしてexecメソッドの中で対処することにする。
  toTurtleString() {
    return ``;
  }

  exec(rdf,store,env,prefixes) {
    if (this.builtin === 'strConcat') {
      if (this.terms.length<2) {
        console.log('Error(strConcat): Number of args must be learger than 2.');
        return;
      }
      let str = '';
      for (let i=0;i<this.terms.length-1;i++) {
        str += this.terms[i].eval(rdf,store,env,prefixes);
      }
      const lastArg = this.terms[this.terms.length-1];
      if (lastArg.type === '変数') {
        env[lastArg.var] = str;
      } else {
        console.log('Error(strConcat): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'notEqual') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return !(a.equals(b));
    } else if (this.builtin === 'equal') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return (a.equals(b));
    } else if (this.builtin === 'lessThan') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return (a < b);
    } else if (this.builtin === 'greaterThan') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return (a > b);
    } else if (this.builtin === 'le') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return (a <= b);
    } else if (this.builtin === 'ge') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      return (a >= b);
    } else if (this.builtin === 'sum') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = (a + b);
      } else {
        console.log('Error(sum): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'addOne') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1];
      if (b.type === '変数') {
        env[b.var] = (a + 1);
      } else {
        console.log('Error(addOne): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'difference') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = (a - b);
      } else {
        console.log('Error(difference): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'min') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = (a<=b)?a:b;
      } else {
        console.log('Error(min): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'max') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = (a>=b)?a:b;
      } else {
        console.log('Error(max): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'product') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = a * b;
      } else {
        console.log('Error(product): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'quotient') {
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2];
      if (c.type === '変数') {
        env[c.var] = a / b;
      } else {
        console.log('Error(quotient): The last term must be a variable.');
      }
      return;
    } else if (this.builtin === 'no') { /// 三つ組の否定判定
      const a = this.terms[0].eval(rdf,store,env,prefixes);
      const b = this.terms[1].eval(rdf,store,env,prefixes);
      const c = this.terms[2].eval(rdf,store,env,prefixes);
      const matches = store.match(a,b,c);
      if (matches.length===0)
        return true;
      else
        return false;
    } else if (this.builtin === 'custom') {
      if (custom_processor===null) {
        console.log('Error(custom): custom_processor is not set up.');
        return;
      }
      return custom_processor(this,rdf,store,env,prefixes);
    } else {
      console.log(`Error: ${this.builtin} is not executable.`);
    }
  }
}

// custom_processorを設定しておくと、ルールの中に
// custom(???)という項目が出てきたらcustom_processorが
// 呼ばれる仕組みを作る。デフォルトのルールのビルトインで
// 対応できない処理を後から追加できる。使い方を詳しく説明
// すると長くなるので、この上のビルトインのexecメソッドの中
// などを参考に解読するべし。
let custom_processor = null;
function set_custom_processor(cp) {
  custom_processor = cp;
}

// ルールのクラス
class Rule {
  // treeは構文解析結果の該当する部分
  constructor(tree) {
    this.lhss = []; // 条件部(Left hand sideの複数形)
    this.rhss = []; // 実行部(Right hand sideの複数形)
    for (const lhs of tree.kids[0].kids) {
      if (lhs.nts_name==='三つ組') {
        this.lhss.push(new Triple(lhs));
      } else if (lhs.nts_name==='ビルトイン') {
        this.lhss.push(new Builtin(lhs));
      }
    }
    for (const rhs of tree.kids[2].kids) {
      if (rhs.nts_name==='三つ組') {
        this.rhss.push(new Triple(rhs));
      } else if (rhs.nts_name==='ビルトイン') {
        this.rhss.push(new Builtin(rhs));
      }
    }
  }

  toString() {
    let s = '';
    for (const l of this.lhss) {
      s += l.toString()+' ';
    }
    s += '-> ';
    for (const r of this.rhss) {
      s += r.toString()+' ';
    }
    s += '.';
    return s;
  }

  // このルールの条件部に対応するようなSPARQLを生成する
  makeSparqlForLHSs() {
    const vars = [];
    for (const lhs of this.lhss)
      lhs.makeVarList(vars);
    let s = 'SELECT ';
    for (const v of vars)
      s += v+' ';
    s += '\nWHERE {\n';
    for (const lhs of this.lhss)
      s += '  '+lhs.toTurtleString()+'\n';
    s += '}\n';
    return s;
  }
}

export { jr_parse, printTree, traverse, set_custom_processor }
