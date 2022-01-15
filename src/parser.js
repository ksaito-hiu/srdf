// parser.js Varsion 20210821
// (c) 2020-2021 Kenji Saito

import { tokenize, python_heredoc, shell_heredoc, javascript_heredoc } from './tokenizer.js';

const symbol_table = {}; // シンボルテーブル
const nts = {};          // (non-terminal symbol)非終端記号=文(statement)などを表すシンボルの保存
const operators = []; // 演算子の文字列のリスト
const punctuators = []; // 区切り子の文字列のリスト
const reserved_words = []; // 予約語の文字列のリスト
let c1_start_str = '//'; // 1行コメントの開始文字列
let cb_start_str = '/*'; // ブロックコメントの開始文字列
let cb_end_str = '*/'; // ブロックコメントの終了文字列

// 式解析中にエラーが発生した時に使用するError
class ExpError extends Error {
  constructor(message,token) {
    super(message);
    this.token = token;
    this.name = 'ExpError';
  }
}

// 式解析中にエラーを見付けた時に，
// 適切に例外を発生させるための関数。
function error(message,token) {
  throw new ExpError(message,token);
}

function dummy_nud(token) {
  error(`Missing nud operator. (${this.str}:${this.type})`,token);
}

function dummy_led(left,token) {
  error(`Missing led operator. (${this.str}:${this.type})`,token);
}

// シンボルを定義する
// できればこの関数より目的に合った関数(infixとかpunctuatorとか)を
// 使った方が色々と良い。
function symbol(name, lbp, nud, led) {
  let s = symbol_table[name];
  if (s) {
    // 中置演算子の-に追加で前置演算子の機能を付け加える時などに
    // このブロックに入る
    // s.str = name || null; // 無くてもいいね
    s.lbp = lbp || s.lbp || 0;
    s.nud = nud || s.nud || dummy_nud;
    s.led = led || s.led || dummy_led;
  } else {
    s = {};
    s.str = name;
    s.lbp = lbp || 0;
    s.nud = nud || dummy_nud;
    s.led = led || dummy_led;
    symbol_table[name] = s;
  }
  return s;
}

// symbolに直接手を加えたい時，例えば
// コード生成や，型チェックをするメソッドを
// 付け足すなどの時にsymbolを取り出すための関数。
function getSymbol(s) {
  return symbol_table[s];
}

// 区切り子を登録する関数
function punctuator(pun) {
  punctuators.push(pun);
  const s = symbol(pun,0,null,null);
  s.mark = '区切り子';
  return s;
}

// 演算子をtokenizerに知らせるために登録する関数
function operator(op) {
  operators.push(op);
  //const s = symbol(op,0,null,null);
  //s.mark = '演算子';
  //return s;
}

// 予約語を登録する関数
function reserved(rsv) {
  const nud = function(token) {
    return [this,token.next];
  };
  reserved_words.push(rsv);
  const s = symbol(rsv,0,nud,null);
  s.mark = '予約語';
  return 
}

// 1行コメントの開始文字列を登録する関数
function set_c1_start_str(s) { c1_start_str = s; }
// ブロックコメントの開始文字列を登録する関数
function set_cb_start_str(s) { cb_start_str = s; }
// ブロックコメントの終了文字列を登録する関数
function set_cb_end_str(s) { cb_end_str = s; }

// 左結合の中置二項演算子のシンボルの定義。
// lbp(left bind power)は演算子の優先順位。
// markはこのシンボルに付けるマーク文字列。
function infix(op, lbp, mark) {
  mark = mark || '中置二項演算子(左結合)';
  const led = function(left,token) {
    this.kids[0] = left;
    let right;
    [right,token] = expression(lbp, token.next);
    this.kids[1] = right;
    this.mark = mark;
    return [this,token];
  };
  operators.push(op);
  return symbol(op, lbp, null, led);
}

// 右結合の中置二項演算子のシンボルの定義
function infixr(op, lbp, mark) {
  mark = mark || '中置二項演算子(右結合)';
  const led = function(left,token) {
    this.kids[0] = left;
    let right;
    [right,token] = expression(lbp - 1, token.next);
    this.kids[1] = right;
    this.mark = mark;
    return [this,token];
  };
  operators.push(op);
  return symbol(op, lbp, null, led);
}

// 前置演算子のシンボルの定義
// markはこのシンボルに付けるマーク文字列。
function prefix(op, rbp, mark) {
  mark = mark || '前置演算子';
  const nud = function(token) {
    let right;
    [right,token] = expression(rbp,token.next);
    this.kids[0] = right;
    this.mark = mark;
    return [this,token];
  };
  operators.push(op);
  return symbol(op,0,nud);
}

// 後置演算子のシンボルの定義
// 
function postfix(op, lbp, mark) {
  mark = mark || '後置演算子';
  const led = function(tree,token) {
    this.kids[0] = tree;
    this.mark = mark;
    return [this,token.next];
  };
  operators.push(op);
  return symbol(op, lbp, null, led);
}

// 3項演算子のシンボルの定義。
// 「operand1 op1 operand2 op2 operand3」の形式の
// 3項演算子を定義する。op2は自動的に区切り子の
// シンボルとして登録される。
function ternary(op1, op2, lbp, mark) {
  mark = mark || '3項演算子';
  const led = function(left,token) {
    this.kids[0] = left;
    [this.kids[1],token] = expression(0,token.next);
    if (token.str !== op2)
      error(`3項演算子(${op1}${op2})の"${op2}"が見付かりません。`,token);
    token = token.next;
    [this.kids[2],token] = expression(0,token);
    this.mark = mark;
    return [this,token];
  };
  punctuator(op2);
  operators.push(op1);
  return symbol(op1, lbp, null, led);
}

// C言語では配列などの初期化子'{}'のみ該当するsymbolを
// 定義する関数。 括弧で囲まれた物を、一つのまとまった
// オペランド(被演算子)にするような演算子。
// op2は自動的で区切り子としての指定もする。
function prefix_bracket_op(op1,op2,mark) {
  mark = mark || '終端記号付きの前置演算子';
  const nud = function(token) {
    let right;
    [right,token] = expression(0,token.next); // 右結合力=0
    this.kids[0] = right;
    if (token.str !== op2)
      error(`"${op1}"に対応する"${op2}"がありません。`,token);
    token = token.next;
    this.mark = mark;
    return [this,token];
  };
  punctuator(op2);
  operators.push(op1);
  return symbol(op1,0,nud);
}

// C言語では配列の添字指定のための鉤括弧'[]'
// のみ該当するsymbolを定義する関数。
// 括弧の中を囲んだ上で、その括弧の前に指定された要素に
// 適用させるような演算子。
// op2は自動で区切り子としての指定もする。
// 関数呼出しの'()'もこれで処理したかったんだけど、
// 関数宣言の'()'とかぶってしまったのであきらめる。
function infix_bracket_op(op1,op2,lbp,mark) {
  mark = mark || '終端記号付きの中置二項演算子';
  const led = function(left,token) {
    this.kids[0] = left;
    if (token.next.str===op2) // "()"とか"[]"とかの場合
      if (token.next.type==='pun') // これも必要だった(かなりまれ)
        return [this,token.next.next];
    let right;
    [right,token] = expression(0, token.next); // 右結合力=0
    this.kids[1] = right;
    if (token.str !== op2)
      error(`"${op1}"に対応する"${op2}"が見付かりません。`,token);
    token = token.next;
    this.mark = mark;
    return [this,token];
  };
  punctuator(op2);
  operators.push(op1);
  return symbol(op1, lbp, null, led);
}



// 必須シンボル
symbol("(end)",0,function(token) {return [this,token];});
symbol("(id)",0,function(token) {return [this,token.next];}); // 識別子(変数とか関数とか)
symbol("(literal)",0,function(token) {return [this,token.next];}); // リテラル(文字列とか数字とか)
symbol("(error)",0,function(token) {return [this,token.next];}); // エラーのトークン

// 数式をパースする関数
function expression(rbp,token) {
  let left;
  [left,token] = token.nud(token);
  while (rbp < token.lbp)
    [left,token] = token.led(left,token);
  return [left,token];
}

function copy_symbol(s) {
  s = Object.create(s);
  s.kids = [];
  return s;
}

// tokenizerで作られたトークンからシンボルの機能を付加した新しい
// トークンを生成する。
function update_token(t) {
  let s;
  if (t.type === 'num') { // 数の場合
    s = copy_symbol(symbol_table['(literal)']);
  } else if (t.type === 'str') {
    s = copy_symbol(symbol_table['(literal)']);
    s.pre_str = t.pre_str;
    s.post_str = t.post_str;
  } else if (t.type === 'hd') {
    s = copy_symbol(symbol_table['(literal)']);
    s.pre_str = t.pre_str;
    s.post_str = t.post_str;
  } else if (t.type === 'id') {
    s = copy_symbol(symbol_table['(id)']);
  } else if (t.type === 'rsv') {
    s = symbol_table[t.str];
    if (s) {
      s = copy_symbol(s);
    } else {
      s = copy_symbol(symbol_table['(error)']);
      s.error = `No such reserved word. (${t.str})`;
    }
  } else if (t.type === 'pun') {
    s = symbol_table[t.str];
    if (s) {
      s = copy_symbol(s);
    } else {
      s = copy_symbol(symbol_table['(error)']);
      s.error = `No such punctuator. (${t.str})`;
    }
  } else if (t.type === 'op') {
    s = symbol_table[t.str];
    if (s) {
      s = copy_symbol(s);
    } else {
      s = copy_symbol(symbol_table['(error)']);
      s.error = `No such operator. (${t.str})`;
    }
  } else if (t.type === '(end)') {
    s = copy_symbol(symbol_table['(end)']);
  } else {
    s = copy_symbol(symbol_table['(error)']);
    s.error = `Unknown token. (${t.str})`;
  }
  s.str = t.str;
  s.type = t.type;
  s.line = t.line;
  s.column = t.column;
  return s;
}

// ***********************************************




// 非終端記号(non-terminal symbol)をパースする関数を登録
function defNTS(nts_name,p) { // 追加
  const s = {};
  s.nts_name = nts_name;
  s.parse = p;
  nts[nts_name] = s;
}

// 非終端記号をパースする関数を返す
// ただ返すと再帰的なパーサーを定義でき
// ないので無名関数でかこむ。
function NTS(name) { // 追加
  return function(token) {
    if (nts[name]) {
      const result = nts[name].parse(token);
      if (result.ok) {
        let tree = result.tree;
        if (tree.nts_name) // すでにNTSなノードだったらラップする
          tree = { str: '#nts', type: '#nts', kids:[tree] };
        // treeにnts[name]に登録された
        // メンバー(nts_nameやコード生成や型チェックなどの
        // 色々な処理)を移植してあげる。
        for (const key of Object.keys(nts[name]))
          tree[key] = nts[name][key];
//console.log("↑GAHA:"+name+":OK");
        return ok(tree,result.token);
      } else {
//console.log("↑GAHA:"+name+":FAIL");
        return result;
      }
    } else {
      console.log("No "+name+" NTS found.");
      return false;
    }
  };
}

// NTSに直接手を加えたい時，例えば
// コード生成や，型チェックをするメソッドを
// 付け足すなどの時にNTSを取り出すための関数。
function getNTS(name) {
  return nts[name];
}

// 以下パーサーコンビネーター関連

// エラー情報を楽に作るための関数。1つのエラーは
// {message: "エラーメッセージ", line: 行数, column: 列数 }
// の形式でなければならず，複数のエラー情報を扱うために
// 最終的には配列で用意しなければならない。
// 引き数のmessageはエラーメッセージ。tokenはエラーが発生
// した場所のトークンで，行数と列数はこのトークンから取り出す。
// errorsは既に検出済みのエラー情報が入っている配列で，新しい
// エラー情報はこの配列の最後に追加されて返される。errors配列
// を省略した場合は今回作成したエラー情報が1個だけ入った配列を
// かえす。
function err(message,token,errors) {
  if (!errors)
    errors = [];
  errors.push({message,line:token.line,column:token.column});
  return errors;
}

// パーサーコンビネーターの返り値は
// {ok:成否, tree:木, token:次のトークン, errors:[エラーの配列]}
// としなければならない。これを簡単に作るための関数2つ，用意した。
// 
// パースが成功した時の結果を作る関数。treeがパース結果の構文木，
// tokenは次に解析しなければならないトークン。
function ok(tree,token) {
  return {ok:true,tree,token,errors:[]};
}
// パースが失敗した時の結果を作る関数。errorsはエラーの配列。
// もしerrorsが配列ではなく文字列だったらエラーは1個しかないという
// 仮定で引き数のtokenとあわせてエラー情報を自動生成する。
// tokenはパースが失敗する前にトラックバックした位置のトークンを
// 指定しなければならない。
function fail(errors,token) {
  if (typeof errors === 'string')
    errors = err(errors,token);
  return {ok:false,tree:null,token,errors};
}


// トークンの文字列(str)が引き数で指定した文字列に
// 等しい時だけ受理するパーサー。
function str(s) {
  return function(token) {
    if (token.str === s) {
      return ok(token,token.next);
    } else {
      return fail(`#str: ${s}が予期されました。`,token); // 最初のtokenを返す
    }
  }
}

// トークンのタイプ('id','num','str'など)が，引き数で指定した物に
// 等しい時だけ受理するパーサー。
function type(t) {
  return function(token) {
    if (token.type === t) {
      return ok(token,token.next);
    } else {
      return fail(`#type: ${t}タイプのトークンが予期されました。`,token); // 最初のtokenを返す
    }
  }
}

// 選択のパーサーコンビネーター
// 今の実装は，候補のパーサーのエラー全部を
// 出す設定だけど，これはどうにかしたい。
function or() {
  const args = arguments;
  return function(token) {
    let result = {token};
    let errors = [];
    for (let i=0;i<args.length;i++) {
      result = args[i](result.token);
      if (result.ok)
        return ok(result.tree,result.token);
      else
        errors = errors.concat(result.errors);
    }
    return fail(errors,token); // 最初のtokenを返す
  }
}

// 順列のパーサーコンビネーター
function seq() {
  const args = arguments;
  return function(token) {
    const tree = { str: '#seq', type: '#seq', kids: [] };
    let result = {token};
    for (let i=0;i<args.length;i++) {
      result = args[i](result.token);
      if (result.ok===false)
        return fail(result.errors,token); // 最初のtokenを返す
      if (result.tree !== null) // 結果がnullなら省略
        tree.kids.push(result.tree);
    }
    return ok(tree,result.token);
  }
}

// 0回以上の繰り返しのパーサーコンビネーター
function many(parser) {
  return function(token) {
    const tree = { str: '#many', type: '#many', kids: [] };
    let result = {token};
    while (true) {
      result = parser(result.token);
      if (result.ok === false)
        return ok(tree,result.token);
      tree.kids.push(result.tree);
    }
  }
}

// 1回以上の繰り返しのパーサーコンビネーター
function many1(parser) {
  return function(token) {
    const tree = { str: '#many1', type: '#many1', kids: [] };
    let result = parser(token);
    if (result.ok === false)
      return fail(result.errors,token); // 最初のtokenを返す
    tree.kids.push(result.tree);
    while (true) {
      result = parser(result.token);
      if (result.ok === false) {
        return ok(tree,result.token); // tokenはこれでいいはず。
      }
      tree.kids.push(result.tree);
    }
  }
}

// 区切り記号で分けられた0回以上の
// 繰り返しのパーサーコンビネーター。
// 区切り記号は構文木には入れない。
function sepBy(parser,delimiter) {
  return function(token) {
    const tree = { str: '#sepBy', type: '#sepBy', kids: [] };
    let result = {token};
    while (true) {
      result = parser(result.token);
      if (result.ok === false)
        return ok(tree,result.token); // tokenはこれでいいはず。
      tree.kids.push(result.tree);
      result = delimiter(result.token);
      if (result.ok === false) {
        return ok(tree,result.token);
      }
    }
  }
}

// 区切り記号で分けられた1回以上の
// 繰り返しのパーサーコンビネーター
// 区切り記号は構文木には入れない。
function sepBy1(parser,delimiter) {
  return function(token) {
    const tree = { str: '#sepBy1', type: '#sepBy1', kids: [] };
    let result = parser(token);
    if (result.ok === false)
      return fail(result.errors,token);
    tree.kids.push(result.tree);
    result = delimiter(result.token);
    if (result.ok === false)
      return ok(tree,result.token);
    while (true) {
      result = parser(result.token);
      if (result.ok === false)
        return ok(tree,result.token);
      tree.kids.push(result.tree);
      result = delimiter(result.token);
      if (result.ok === false) {
        return ok(tree,result.token);
      }
    }
  }
}

// 0回か1回のパーサーコンビネーター
function opt(parser) {
  return function(token) {
    const tree = { str: '#opt', type: '#opt', kids: [] };
    let result = parser(token);
    if (result.ok)
      tree.kids.push(result.tree);
    return ok(tree,result.token);
  }
}

// 与えられたパーサーを実行する前に、何か必要な
// 処理がある場合に、その処理を指定するための
// パーサー。その処理をするための関数はfunc引数
// として渡す。func関数の引数は1つで、これから
// 処理予定のtoken。通常のプログラミング言語では、
// ブロックの文法解析を始める前に、識別子の管理を
// する環境(Environment)のスコープを新しくして
// 一段深くする必要があるが、そんな処理をするのに
// 適している。パーサーが文法解析した後に、色々
// 処理したい場合は、すぐ下のmodifyを使うべし。
// でも、このprepare使うよりもtokenを受け取って
// resultを返す無名関数を作った方が簡単なので、
// これを使う意味はほとんど無いと思う。
function prepare(parser,func) {
  return function(token) {
    funk(token);
    return parser(token);
  }
}

// parserの結果をチェックしたり手を加えるための
// パーサーコンビネーター。funcの引き数は2つで，
// 一つ目は指定したparserの解析結果，2つ目は
// 指定したparserが解析を始める前のtoken。
// 2つ目の引き数が必要なわけは，
// 指定したparserが成功を返したけど，その結果を
// 調べてみたら失敗にするべきだという場合に，
// funcの2つ目の引き数のtokenを使ってfailするため。
// でも、このmodify使うよりもtokenを受け取って
// resultを返す無名関数を作った方が簡単なので、
// これを使う意味はほとんど無いと思う。
function modify(parser,func) {
  return function(token) {
    let result = parser(token);
    if (result.ok) {
      result = func(result,token);
      return result;
    }
    return fail(result.error,result.token);
  }
}

// 指定されたparserを実行して同じ結果を返す
// パーサーコンビネーター。でもトークンは
// 成功しても失敗しても消費しない。
function lookAhead(parser) {
  return function(token) {
    const result = parser(token);
    if (result.ok) {
      return ok(result.tree,token);
    }
    return fail(result.errors,token);
  }
}

// 指定されたparserの成功と失敗を逆転させる
// パーサーコンビネーター。でもトークンは
// 成功しても失敗しても消費しない。
function notFollowedBy(parser) {
  return function(token) {
    const result = parser(token);
    if (result.ok) {
      return fail('notFollowedBy: failed.',token);
    }
    return ok(null,token);
  }
}

// 指定されたparserを実行して成功，失敗，エラーメッセージは
// そのまま返すけど，treeをnullにして返すパーサー。
// つまり解析して正しいことはチェックするけど，データーと
// として残しておく必要のない部分を省略するためのパーサーで，
// 区切り記号の部分などに使うと解析結果の構文木がすっきりする。
// でも意味があるのは，これがseqパーサーの中に置かれた時のみ。
// manyの中とか，直に呼び出す場合はnullが結果の木として残ることになる。
function omit(parser) {
  return function(token) {
    const result = parser(token);
    result.tree = null;
    return result;
  }
}

// 「式」をパースするためのパーサーコンビネーター
// 通常は引き数を与えずに使う。引数に順次演算子(',')の
// 左結合力(c_parser.mjsの場合5)より大きな値を指定すると
// ','で区切られた式を分けて一つづつパースできる。
function exp(bp) {
  const rbp = bp || 0;
  return function(token) {
    try {
      let tree, next_token;
      [tree,next_token] = expression(rbp,token);
      return ok(tree,next_token);
    } catch(ee) {
console.log("GAHA: "+ee.stack);
      return fail(ee.message,ee.token);
    }
  }
}

// 文字列の配列を受け取り，文字列長の長い順にソートする関数
// 同じ文字列長の要素の順番はなるべく変えないようにソートする。
// in placeに(破壊的に)ソートする。たぶんバブルソート。
function my_sort(array) {
  for (let s=array.length-2;s>=0;s--) {
    for (let t=0;t<=s;t++) {
      if (array[t].length < array[t+1].length) {
        const tmp = array[t];
        array[t] = array[t+1];
        array[t+1] = tmp;
      }
    }
  }
}

// 最終的にプログラム全体を構文解析させるための関数
// 最上位の非終端記号の名前を第一引数に与えるべし。
function parse(nts_name,src,cfg_obj) {
  // tokenizerに受け渡すために自動登録された演算子，区切り子，予約語の
  // リストを整理する。tokenizerはリストで指定された物を先頭から順番に
  // 前方一致検索してトークンを判別するので，長い文字列を先に持ってこな
  // いと，上手く判別できない。よって，文字列長でソートする。JavaScriptの
  // 配列のsort()は，同じ順序を持つ要素の順番を保証しないけど，なるべく
  // 登録の順番を維持したいので上の自前のmy_sortを使うことにした。
  // ただしユーザーがcfg_objで演算子，区切り子，予約語のリストを提供する
  // 場合には，そちらを優先する。
  my_sort(operators);
  my_sort(punctuators);
  my_sort(reserved_words);

  // 字句解析用のデフォルトのパラメーター
  cfg_obj = cfg_obj || {};
  const cfg = {
    id1st: cfg_obj.id1st || '[a-zA-Z_\u00c0-\u1fff\u3040-\u318f\u3400-\u3d2d\u4e00-\u9fff\uf900-\ufaff]',
    id2nd: cfg_obj.id2nd || '[a-zA-Z_\u00c0-\u1fff\u3040-\u318f\u3400-\u3d2d\u4e00-\u9fff\uf900-\ufaff0-9]',
    num: cfg_obj.num || '[0-9]',
    operators: cfg_obj.operators || operators || ['<<=','>>=','==','++','--','+=','-=','*=','/=','%=','<=','>=','!=','&=','|=','^=','<<','>>','&&','||','->','=','+','-','*','/','%','<','>','&','|','!','~','^','?','(','[','.',','],
    punctuators: cfg_obj.punctuators || punctuators || ['{','}',';',')',']',':'],
    reserved_words: cfg_obj.reserved_words || reserved_words || [],
    c1_start_str: cfg_obj.c1_start_str || c1_start_str || '//',
    cb_start_str: cfg_obj.cb_start_str || cb_start_str || '/*',
    cb_end_str: cfg_obj.cb_end_str || cb_end_str || '*/',
    indent: cfg_obj.indent || false,
    tab_width: cfg_obj.tab_width || 8, // tab_width=0は不可ってことで
    heredoc: cfg_obj.heredoc ||  null
  };
  let result = tokenize(src,cfg);
  if (result.ok === false)
    return fail(result.errors,null);

  const tokens = [];
  for (let i=0;i<result.tokens.length;i++) {
    tokens[i] = update_token(result.tokens[i]);
//console.log("GAHA:token{str:"+tokens[i].str+",type:"+tokens[i].type+"}");
    if (i===0) {
      tokens[i].prev = null; // undefinedにしたくないので
    } else {
      tokens[i-1].next = tokens[i];
      tokens[i].prev = tokens[i-1];
    }
    tokens[i].next = null; // undefinedにしたくないので
  }

  result = NTS(nts_name)(tokens[0]);
  return result;
}

// 構文解析結果のtreeを階層的に表示する関数。
// 各設定はaaa:bbbまたはaaa:bbb{NTS#ccc}の形式で
// 表示されるが，aaaはstrの値，bbbはtypeの値
// cccはnts_nameの値を表している。
function printTree(t) {
  let str = printTreeX(t,'');
  console.log(str);
  return str;
}
function printTreeX(t,indent) {
  let str = indent;
  if (!t) {
    str += "null\n";
  } else {
    str += t.str+':'+t.type;
    if (t.mark)
      str += "{mark@"+t.mark+'}';
    if (t.nts_name)
      str += "{NTS#"+t.nts_name+'}';
    str += "\n";
    for (let i=0;i<t.kids.length;i++) {
      str += printTreeX(t.kids[i],indent+'  ');
    }
  }
  return str;
}

// 構文木をたどって色々処理をするのに便利な関数。
// 第1引き数が木，第2引き数が処理を行う関数。
// 第3引き数はアキュムレーターの初期値。
// アキュムレーター(accumulator)とは，なんかを
// 集約するためのデーター構造。第2引き数の関数は
// 現在の節点とアキュムレーターを受け取り，
// アキュムレーターを返さなければならない。
// 受け取るアキュムレーターと返すアキュムレーターは
// 同じオブジェクトでも，新しく置き換えたオブジェクト
// でも良い。木をたどる順番は子孫優先。つまり葉が
// 最初に処理されてだんだん根の方に向って処理される。
// 書いてみたらたいした処理じゃないね。
function traverse(tree,func,acc) {
  if (tree.kids)
    for (let k of tree.kids)
      if (!k)
        acc = traverse(k,func,acc);
  return func(tree,acc);
}

// 以下，変数などを管理するための「環境(env)」の
// プログラム。

const original_env = {
  define: function (name,type,value) {
    if (this.def[name]) {
      return {ok:false, error:`${name} is already defined.`};
    }
    type = type || null;
    value = (value!==undefined)? value : null;
    const id = {
      "name": name,
      "type": type,
      "value": value,
      "env": env
    };
    this.def[name] = id;
    return {ok:true, id};
  },
  find: function (name) {
    let e = this, id;
    while (!e) {
      id = e.def[name];
      if (id)
        return {ok:true,id};
      e = e.parent;
    }
    return {ok:false, error:`${name} is not defined.`};
  },
  pop: function () {
    return this.parent;
  },
};

function new_env(env) {
  var e = env;
  env = Object.create(original_env);
  env.def = {};
  env.parent = e;
  return env;
}

export {
  python_heredoc, shell_heredoc, javascript_heredoc, error, symbol, getSymbol,
  punctuator, operator, reserved, set_c1_start_str, set_cb_start_str,
  set_cb_end_str, infix, infixr, prefix, postfix, ternary,
  prefix_bracket_op, infix_bracket_op, expression, defNTS, NTS, getNTS,
  err, ok, fail, str, type, or, seq, many, many1, sepBy, sepBy1, opt,
  prepare, modify, notFollowedBy, lookAhead, omit, exp, parse, printTree,
  traverse, new_env
}
