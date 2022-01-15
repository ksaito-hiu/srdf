// tokenizer.mjs Version 20211123
// (c) 2019-2021 Kenji Saito
//
// 様々な言語で利用できるように，カスタマイズできる字句解析器を目指す。
// コメントや空白はトークンから除外する字句解析器。
// 字句解析結果は以下のようなオブジェクトになる。
//
// 「a = "abc";」と入れた時
// { ok: true,
//   errors: [],
//   tokens: [ { str: 'a',     type: 'id',    line: 0,  column: 0,
//               next: 次のトークン, prev: 前のトークン },
//             { str: '=',     type: 'op',    line: 0,  column: 2,
//               next: 次のトークン, prev: 前のトークン },
//             { str: 'abc',   type: 'str',   line: 0,  column: 4, pre_str: '"', post_str: '"',
//               next: 次のトークン, prev: 前のトークン },
//             { str: ';',     type: 'pun',   line: 0,  column: 9,
//               next: 次のトークン, prev: 前のトークン },
//             { str: '(end)', type: '(end)', line: -1, column: -1,
//               next: 次のトークン(null), prev: 前のトークン } ]
// }
// 
// この上の例のようにエラーが無かったとすれば，あとはtokensの最初の要素
// だけが必要な物になるはず。その要素の.nextメンバーが次の2つ目のトークンを
// 示していて，.prev要素で前のトークンが得られる。つまり双方向リスト。
// 
// もし解析中にエラーが見付かった場合には以下のような感じになる。
// 「a = "abc;」と入れた時
// { ok: false,
//   errors: [ { message: '文字リテラルが閉じていません', line: 0, column: 9 } ],
//   tokens: [ { str: 'a',     type: 'id',    line: 0,  column: 0,
//               next: 次のトークン, prev: 前のトークン },
//             { str: '=',     type: 'op',    line: 0,  column: 2,
//               next: 次のトークン, prev: 前のトークン },
//             { str: '(end)', type: '(end)', line: -1, column: -1,
//               next: 次のトークン(null), prev: 前のトークン } ]
// }
//
// 字句のtypeには以下の7種類がある。
// * rsv: 予約語
// * id: 識別子
// * num: 数字
// * hd: ヒアドキュメント
// * str: 文字リテラル
// * op: 演算子
// * pun: 区切り子(Punctuator)もしくは残りかす
// さらに入力プログラムの終りを明示するために以下の
// 字句typeを追加した。
// * (end): プログラムの終り
// strは文字リテラルなのだが，その文字を囲んでいた引用符の
// 区別がつくように，pre_strとpost_strというメンバーが付いている。
// hd(ヒアドキュメント)についても同様。
//
//
// 以下ユーザーが実際に実行するtokenize関数の説明。
// 設定パラメーターを含むオブジェクトを与えて字句解析を実行する。
// ソースプログラムの文字列を与えると
// トークンの配列を含むオブジェクトを返す。
// 設定パラメーターの説明:
// id1st: 識別子の1文字目にマッチする正規表現の文字列
// id2nd: 識別子の2文字目以降にマッチする正規表現の文字列
// num: 数字と判別される文字にマッチする正規表現の文字列
// operators: 演算子の文字列の配列。順番に前方一致検索するので長い演算子を配列の先に指定するべし。
// punctuators: 区切り子の文字列の配列。順番に前方一致検索するので長い区切り子を配列の先に指定するべし。
// reserved_words: 予約語の文字列の配列。順番に前方一致検索するので長い予約語を配列の先に指定するべし。
// c1_start_str: 1行コメントの最初の文字列
// cb_start_str: ブロックコメント(複数行コメント)の最初の文字列
// cb_end_str: ブロックコメントの最後の文字列
// indent: ブロックの自動挿入トークンの有効化
// tab_width: タブ幅を何文字と見做すかの数字(tab_width=0は不可ってことで)
// heredoc: ヒアドキュメントの判定をする関数
// 
// 上にも書いたようにoperators,punctuators,reserved_wordsは複数の
// 文字列を配列に入れて指定する設定項目だけど，配列の前の方から
// 前方一致検索でそれぞれのトークンを切り出す仕組みなので，例えば
// '=='の前に'='を入れちゃったりすると'=='が'='2つに分解されて
// 切り出されるので順番に気をつけるべし。
// 引数のindentは，Pythonみたいにインデントで
// ブロックを表現する言語において，C言語風の
// ブロックの区切り子(すなわち'{'と'}')を
// 自動的に入れるかどうかをtrueかfalseで指定する。
// heredocにソースとインデックスを引数に取り
// ヒアドキュメントの判定を行う関数を指定すると
// ヒアドキュメントを字句解析の結果として出力
// できるようになる。heredocの詳細はmemo.mmを参照。
//
// 現状C言語のsizeof演算子のような識別子風な演算子は
// 演算子でなく識別子と判別されてしまう。また','は場所に
// よって演算子，識別子の区別をしたいところだが，現在の
// デフォルトパラメーターでは演算子に判別される。これらは
// 文法解析の方でなんとかするしかないと思う。
// また，エラー回復についてはまだ勉強が足りてないのだが，
// 無理矢理実装してみた。


// 以下字句解析を行う上での各種パラメーター
let rx_id1st; // 識別子の最初の文字にマッチする正規表現
let rx_id2nd; // 識別子の2文字目以降の文字にマッチする正規表現
let rx_num; // 数字と判定される文字にマッチする正規表現
let operators; // 演算子の文字列の配列。順番に前方一致検索するので長い演算子を配列の先に指定するべし。
let punctuators; // 区切り子の文字列の配列。順番に前方一致検索するので長い区切り子を配列の先に指定するべし。
let reserved_words; // 予約語の文字列の配列。順番に前方一致検索するので長い予約語を配列の先に指定するべし。
let c1_start_str; // 一行コメントの開始記号
let cb_start_str; // ブロックコメントの開始記号
let cb_end_str; // ブロックコメントの終了記号
let indent; // インデントによるブロック判定をして
let tab_width; // タブ幅(0は不可)
let heredoc; // ヒアドキュメントを処理するための関数

let errors; // エラー情報の配列
let source; // ソースプログラム
let index; // 現在解析中の位置(ソースの先頭からの文字数,0から)
let c; // 現在解析中の文字
let line_nr; // 現在処理中の行の行番号(0から)
let column_nr; // 行の中の何文字目を処理中かの数字(0から)
let tokens; // 字句解析結果のトークンを入れておく配列
let indent_stack; // インデントを記録しておくためのスタック

// ソースファイル中の改行を全て'\n'に統一し，
// Tabを半角スペースに変換する。
function preprocessor(s,tab_width) {
  let ss = '';
  let i = 0;
  let col = 0;
  let ch = s.charAt(i);
  while (i < s.length) {
    if (ch === '\r') {
      i++;
      ch = s.charAt(i);
      if (ch === '\n') {
        i++;
        ch = s.charAt(i);
      }
      ss += '\n';
      col = 0;
    } else if (ch === '\n') {
      ss += ch;
      col = 0;
      i++;
      ch = s.charAt(i);
    } else if (ch === '\t') {
      let n = 8 - (col % tab_width);
      for (let j=0;j<n;j++) {
        ss += ' ';
        col++;
      }
      i++;
      ch = s.charAt(i);
    } else {
      ss += ch;
      col++;
      i++;
      ch = s.charAt(i);
    }
  }

  return ss;
}



// 値とタイプから新しいトークンを作る。
// カラム数を指定したい時はcolを与える。
// 行数を指定したい時はlnを与える。
// pre_strとpost_strは文字列リテラルやheredocument
// のトークンの時、それが表す文字列の前と後ろの
// 部分を表す情報。
function createToken(str,type,col,ln,pre_str,post_str) {
  const t = {};
  t.str = str;
  t.type = type;
  t.line = ln===undefined?line_nr:ln;
  t.column = col===undefined?column_nr:col;
  if (pre_str) t.pre_str = pre_str;
  if (post_str) t.post_str = post_str;
  if (tokens.length === 0) {
    t.prev = null; // undefinedにしたくないので
  } else {
    tokens[tokens.length - 1 ].next = t;
    t.prev = tokens[tokens.length - 1 ];
  }
  t.next = null; // undefinedにしたくないので
  tokens.push(t);
};

// 引数無しの場合，
// 現在解析中の文字を一文字進めてtrueを返す。
// 引数(文字列)ありの場合，その文字列を読み
// 飛ばして，その次の文字まで進めてtrueを返す。
// でも，その文字列が無かったら進まずに
// falseを返す。
function advance(next) {
  if (next === undefined) {
    index++;
    column_nr++;
    c = source.charAt(index);
    return true;
  } else {
    const index_backup = index;
    const column_backup = column_nr;
    let i = 0;
    while (i<next.length) {
      if (c !== next.charAt(i)) {
        index = index_backup;
        column_nr = column_backup;
        c = source.charAt(index);
        return false;
      }
      index++;
      column_nr++;
      c = source.charAt(index);
      i++;
    }
    return true;
  }
};

// 現在解析中の文字を一文字もどす
// (advanceの反対みたいな感じ)
function restore() {
  index--;
  c = source.charAt(index);
};

// 改行の処理。処理できたらtrue。
// その他，行数や列数のカウント，
// インデントブロックに対応する
// 自動トークン生成もやる。
function ret() {
  if (c !== '\n')
    return false;
  advance();
  line_nr++;
  column_nr = 0;
  if (indent===false)
    return true;
  // 以下インデントブロックの自動トークン生成
  let next_indent = 0;
  while (source.charAt(index+next_indent)==' ') {
    next_indent++;
  }
  let current_indent = indent_stack[indent_stack.length-1];
  if (next_indent===current_indent) // この場合何もしなくてOK
    return true;
  else if (next_indent>current_indent) {
    indent_stack.push(next_indent);
    createToken('{','pun',-1,-1);
    return true;
  }
  while (next_indent<current_indent) {
    indent_stack.pop();
    createToken('}','pun',-1,-1);
    current_indent = indent_stack[indent_stack.length-1];
    if (current_indent < next_indent) {
      throw new Error("インデントのエラー。どのインデントのレベルにも合いません。");
    }
  }
  return true;
};

// whitespaceの読み飛し。処理できたらtrue。
// (tabは半角スペースに変換済み)
function whitespace() {
  if (c !== ' ') return false;
  while (c === ' ') advance();
  return true;
};

// 演算子の処理
function operator() {
  let selected_op = null;
  for (const op of operators) {
    const len = op.length;
    const sub = source.substr(index,len);
    if (op === sub) {
      selected_op = op;
      break;
    }
  }
  if (selected_op === null)
    return false;
  const column_memo = column_nr;
  for (let i=0;i<selected_op.length;i++) {
    advance();
  }
  createToken(selected_op,'op',column_memo);
  return true;
}

// 予約語の処理
function reserved() {
  let selected_rsv = null;
  for (const rsv of reserved_words) {
    const len = rsv.length;
    const sub = source.substr(index,len);
    if (rsv === sub) {
      selected_rsv = rsv;
      break;
    }
  }
  if (selected_rsv === null)
    return false;
  const column_memo = column_nr;
  for (let i=0;i<selected_rsv.length;i++)
    advance();
  createToken(selected_rsv,'rsv',column_memo);
  return true;
}

// 識別子の処理
function identifier() {
  let id = '';
  const column_memo = column_nr;
  if (!c.match(rx_id1st))
    return false;
  id += c;
  advance();
  while (c.match(rx_id2nd)) {
    id += c;
    advance();
  }
  createToken(id,'id',column_memo);
  return true;
}

// 数字の処理
function number() {
  if (c !== '.' && !c.match(rx_num))
    return false;
  const column_memo = column_nr;
  let num = '';
  if (c === '.') { // '.'で初まる特殊な場合
    advance();
    if (!c.match(rx_num)) {
      restore();
      return false;
    }
    restore();
  } else { // ここにくるのは整数部分
    num += c;
    advance();
    while (c.match(rx_num)) {
      num += c;
      advance();
    }
  }
  if (c === '.') { // 少数部分
    num += c;
    advance();
    while (c.match(rx_num)) {
      num += c;
      advance();
    }
  }
  if (c === 'e' || c === 'E') { // 指数部分
    num += c;
    advance();
    if (c === '+' || c === '-') {
      num += c;
      advance();
    }
    while (c.match(rx_num)) {
      num += c;
      advance();
    }
  }

  createToken(num,'num',column_memo);
  return true;
}

// ヒアドキュメントの処理
// ヒアドキュメントの判定をしてくれる
// heredocを利用してヒアドキュメントを
// 処理する。詳細はmemo.mmを参照。
// (pythonのことを考えて，文字リテラル
// より先に処理すべし。)
function heredocument() {
  if (heredoc === null) // ヒアドキュメントは処理しない場合
    return false;

  // ヒアドキュメントの開始判定
  let res = heredoc(source,index);
  if (res.start === false)
    return false;
  // ここからヒアドキュメントの処理
  const line_memo = line_nr;
  const column_memo = column_nr;
  const pre_str = res.pre_str;
  for (let i=0;i<pre_str.length;i++)
    advance();
  let hd = c;
  // 開始判定結果のend_checkに終了判定用関数が入っている
  const end_check = res.end_check;
  advance();

  while (index < source.length) {
    // ヒアドキュメント(の中の文字列)が終了しているかどうかの判定
    res = end_check(source,index);
    if (res.end === true) {
      const post_str = res.post_str;
      createToken(hd,'hd',column_memo,line_memo,pre_str,post_str);
      for (let i=0;i<post_str.length;i++)
        advance();
      return true;
    }
    hd += c;
    if (c === '\n') {
      line_nr++;
      column_nr = 0;
    }
    advance();
  }

  // ソースの最後まで来たけどヒアドキュメントが閉じてない
  let msg = ""+(line_memo+1)+"行，"+(column_memo+1)+"列";
  msg += "から開始しているヒアドキュメントが";
  msg += "閉じてません。";
  throw new Error(msg);
}

// 文字列リテラルの処理。必ず1行。
// (複数行の文字列リテラルはヒアドキュメントで)
function string_lit() {
  if (c !== '"' && c !== '\'')
    return false;
  const q = c;
  let str = '';
  const column_memo = column_nr;

  advance();
  while (c !== q) {
    if (c === '\n' || index >= source.length) {
      throw new Error("文字列リテラルが閉じてません。");
    }
    str += c;
    if (c === '\\') { // エスケープは無条件で入れる
      advance();    // (特に引用符の場合でも)
      str += c;
    }
    advance();
  }
  advance();

  createToken(str,'str',column_memo,line_nr,q,q);
  return true;
}

// 1行コメントの読み飛し。処理できたらtrue。
function comment_1line() {
  if (!advance(c1_start_str)) return false;
  while (!ret() && index < source.length-1) advance();
  return true;
};

// 複数行コメントの読み飛し。処理できたらtrue。
function comment_block() {
  if (!advance(cb_start_str)) return false;
  let nest = 1;
  while (index < source.length-1) {
    if (ret()) { // 改行
      // 単純に処理するだけ
    } else if (advance(cb_start_str)) { // コメント内でコメント
      nest++;
    } else if (advance(cb_end_str)) { // コメント終了
      nest--;
      if (nest === 0)
        return true;
    } else { // それ以外
      advance();
    }
  }
  return true;
};

// 区切り子の処理
function punctuator() {
  let selected_pun = null;
  for (const pun of punctuators) {
    const len = pun.length;
    const sub = source.substr(index,len);
    if (pun === sub) {
      selected_pun = pun;
      break;
    }
  }
  if (selected_pun === null)
    return false;
  const column_memo = column_nr;
  for (let i=0;i<selected_pun.length;i++)
    advance();
  createToken(selected_pun,'pun',column_memo);
  return true;
}


// 以下ユーザーが実際に実行するtokenize関数
function tokenize(src,cfg_obj) {
  // 設定パラメーターをcfg_objから取得
  const cfg = cfg_obj || {};
  rx_id1st = new RegExp(cfg.id1st || '[a-zA-Z_\u00c0-\u1fff\u3040-\u318f\u3400-\u3d2d\u4e00-\u9fff\uf900-\ufaff]');
  rx_id2nd = new RegExp(cfg.id2nd || '[a-zA-Z_\u00c0-\u1fff\u3040-\u318f\u3400-\u3d2d\u4e00-\u9fff\uf900-\ufaff0-9]');
  rx_num = new RegExp(cfg.num || '[0-9]');
  operators = cfg.operators || ['<<=','>>=','==','++','--','+=','-=','*=','/=','%=','<=','>=','!=','&=','|=','^=','<<','>>','&&','||','->','=','+','-','*','/','%','<','>','&','|','!','~','^','?','(','[','.',','];
  punctuators = cfg.punctuators || ['{','}',';',')',']',':'];
  reserved_words = cfg.reserved_words || [];
  c1_start_str = cfg.c1_start_str || '//';
  cb_start_str = cfg.cb_start_str || '/*';
  cb_end_str = cfg.cb_end_str || '*/';
  indent = cfg.indent || false;
  tab_width = cfg.tab_width || 8; // tab_width=0は不可ってことで
  heredoc = cfg.heredoc || null;

  // エラーメッセージリセット
  errors = [];
  // 入力ソースファイルの改行とTabの前処理を行う
  source = preprocessor(src,tab_width);
  // 色々初期化
  // 変数の説明は上の方参照
  index = 0;
  line_nr = 0;
  column_nr = 0;
  c = source.charAt(index);
  tokens = [];
  indent_stack = [0];

  while (index < source.length) {
    try {
      // 以下の処理，順番を間違えると上手くいかないので注意
      if (ret()) {                  // 改行(EOL)
      } else if (whitespace()) {    // 空白文字
      } else if (heredocument()) {  // ヒアドキュメント
      } else if (comment_block()) { // ブロックコメント
      } else if (comment_1line()) { // 1行コメント
      } else if (string_lit()) {    // 文字列リテラル
      } else if (operator()) {      // 演算子
      } else if (reserved()) {      // 予約語
      } else if (identifier()) {    // 識別子
      } else if (number()) {        // 数字
      } else if (punctuator()) {    // 区切り子
      } else { // どれにも対応しないトークンが出てきた
        const e_msg = `判別不能なトークン(字句)が出現しました。(${c})`;
        advance();
        throw new Error(e_msg);
      }
    } catch(err) {
      errors.push(
        { message: err.message,
          line: line_nr,
          column: column_nr});
    }
  }
  createToken('(end)','(end)',-1,-1);
  return {
    ok: !(errors.length > 0),
    errors,
    tokens: tokens };
}

// Python形式のヒアドキュメントの開始と終了を
// 判定する関数。区切りとなる記号が'"""'と"'''"の2種類ある。
// 開始判定結果は { start: false } という形式か
// { start: true, pre_str: '"""', end_check: 終了判定の関数 } となる。
// 終了判定の関数の判定結果は { end: false } という形式か
// { end: true, post_str: '"""' } となる。
const python_heredoc = function(src1,idx1) {
  const str1 = src1.substr(idx1,3);
  if (str1 === "'''") {
    return { start: true, pre_str: str1, end_check: function(src2,idx2) {
      const str2 = src2.substr(idx2,3);
      if (str2 === str1) {
        return { end: true, post_str: str2 };
      }
      return { end: false };
    }};
  }
  if (str1 === '"""') {
    return { start: true, pre_str: str1, end_check: function(src2,idx2) {
      const str2 = src2.substr(idx2,3);
      if (str2 === str1) {
        return { end: true, post_str: str2 };
      }
      return { end: false };
    }};
  }
  return { start: false };
}

// Unixシェル形式のヒアドキュメントをチェックする関数
// Pythonの時と違って，ユーザーが自由に区切りとなる
// 文字列を指定できるので，そのへんがポイント。
const shell_heredoc = function(src1,idx1) {
  if (src1.charAt(idx1+0)!=='<'
      || src1.charAt(idx1+1)!=='<')
    return { start: false };

  let delimiter = '';
  let pre_str = '<<';
  let i=2;
  while (idx1+i < src1.length) { // whitespace読み飛ばし
    if (src1.charAt(idx1+i) !== ' ') break;
    pre_str += ' ';
    i++;
  }
  while (idx1+i < src1.length) { // 区切り記号の読み込み
    let ch = src1.charAt(idx1+i);
    if ( ch === ' ' || ch === '\n') break;
    delimiter += ch;
    pre_str += ch;
    i++;
  }

  // ヒアドキュメントの終了条件を判定してくれる関数。
  const end_check = function(src2,idx2) {
    // 以下は大事なポイント！
    // Unixシェル形式のヒアドキュメントの終了の
    // 区切り記号は，必ず**行頭**に置かれなければ
    // ならないが，行頭であることの判定は
    // 区切り記号の直前に'\n'があるかどうかを見れば良い。
    const str2 = src2.substr(idx2,delimiter.length+1);
    if (str2 !== ("\n"+delimiter))
      return { end: false };
    return { end: true, post_str: ("\n"+delimiter) };
  };

  return { start: true, pre_str, end_check };
}

// JavaScript形式のヒアドキュメントの開始と終了を
// 判定する関数。
const javascript_heredoc = function(src1,idx1) {
  const str1 = src1.charAt(idx1);
  if (str1 === '`') {
    return { start: true, pre_str: str1, end_check: function(src2,idx2) {
      const str2 = src2.charAt(idx2);
      if (str2 === '`') {
        return { end: true, post_str: str2 };
      }
      return { end: false };
    }};
  }
  return { start: false };
}

export { tokenize, python_heredoc, shell_heredoc, javascript_heredoc }
