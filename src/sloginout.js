// WebIDによるログイン・ログアウトの処理をサポートするモジュール

//import { solidClientAuthentication } from '@inrupt/solid-client-authn-browser';
const solidClientAuthentication = require('@inrupt/solid-client-authn-browser');

const auth = solidClientAuthentication;

// UIをログイン状態にする．
// (CSSのclassがs_logged_inの物をdisplay: block;にして
//  s_logged_outの物をdisplay: none;にして，s_login_status
//  の物のtextContentにloginの状態を書き込む)
function s_ui_logged_in() {
  for (let e of document.querySelectorAll(".s_logged_in")) {
    e.style.display = "block";
  }
  for (let e of document.querySelectorAll(".s_logged_out")) {
    e.style.display = "none";
  }
  const info = auth.getDefaultSession().info;
  if (info.isLoggedIn) {
    for (let e of document.querySelectorAll(".s_login_status")) {
      e.textContent = 'You are logged in as <'+(info.webId)+'>.';
    }
  }
}

// UIをログアウト状態にする．
// (CSSのclassがs_logged_inの物をdisplay: none;にして
//  s_logged_outの物をdisplay: block;にして，s_login_status
//  の物のtextContentに"not logged in"を書き込む)
function s_ui_logged_out() {
  for (let e of document.querySelectorAll(".s_logged_in")) {
    e.style.display = "none";
  }
  for (let e of document.querySelectorAll(".s_logged_out")) {
    e.style.display = "block";
  }
  for (let e of document.querySelectorAll(".s_login_status")) {
    e.textContent = "not logged in";
  }
}

// ログイン状態に合せてUIを初期化する処理
function s_ui_update() {
  const info = auth.getDefaultSession().info;
  if (info.isLoggedIn) {
    s_ui_logged_in();
  } else {
    s_ui_logged_out();
  }
}

//loginout.htmlをポップアップウィンドウで出すための関数
let loginout_window;
function loginoutWindow(anchor) {
  const W=500,H=300;
  let url = anchor.getAttribute('href');
  if (loginout_window==null || loginout_window.closed) {
    url = encodeURI(decodeURI(url));
    const wTop = window.screenTop + (window.innerHeight / 2) - (H / 2);
    const wLeft = window.screenLeft + (window.innerWidth / 2) - (W / 2);
    let features = 'width='+W+', height='+H;
    features += ', top=' + wTop + ', left=' + wLeft;
    features += ', personalbar=0, toolbar=0, scrollbars=1, resizable=!';
    loginout_window = window.open(url, "Loginout!", features);
  } else {
    loginout_window.focus();
  }
}

// ページの初期化と，セッションの監視(ログイン・ログアウトの監視)開始。
// もし，ページの中にクラスがs_loginoutというAnchorが
// あったら，これをボタン化してポップアップでloginout画面を
// 出すように初期化する。hrefには正しいloginout.htmlへのパスが
// 設定されていることが前提。それから，ポップアップウィンドウから
// もともとのウィンドウに戻ってきた時にUIが更新されるように，
// window.addEventListener('focus',s_ui_update);とする。
// これちょっと無駄も多いんだけど，ポップアップウィンドウの
// closeを検知する方法に色々問題があって上手くいかなのと，
// そんなに重くならないみたいなんで，しょうがなく。さらに
// windowのfocusを使ったら，セッションの監視が必要ない感じ
// だけど，念のため残しておく。
async function s_ui_init() {
  window.addEventListener('focus',s_ui_update);

  // ログイン時の処理
  auth.onLogin(() => {
    if (auth.getDefaultSession().info.isLoggedIn) {
      s_ui_logged_in();
    }
  });

  // ログアウト時の処理
  auth.onLogout(() => {
    if (!(auth.getDefaultSession().info.isLoggedIn)) {
      s_ui_logged_out();
    }
  });

  await auth.handleIncomingRedirect({
    restorePreviousSession: true
  });
  s_ui_update();

  const a = document.querySelector('a.s_loginout');
  if (!!a) {
    a.addEventListener("click",(e)=>{
      e.preventDefault();
      loginoutWindow(a);
    });
    a.style.background = '#F0E68C';
    a.style.color = '#000000';
    a.style.cursor = 'pointer';
    a.style.padding = '2px 5px';
    a.style.margin = '2px 5px';
    a.style.borderRadius = '5px';
    a.style.boxShadow = '4px 4px 2px #666666';
  }
}
document.addEventListener("DOMContentLoaded",s_ui_init);

// なぜかWebIDでログインさせたいのだけど、そういう機能が
// 無かったのでWebIDのoriginをoidcIssuerとしてログインさせている。
function s_login(webId) {
  if (!webId) {
    console.log("s_login() Error: webId is not specifiled.");
    return;
  }
  const url = new URL(webId).origin;
  auth.login({
    //webId: wid,
    oidcIssuer: url,
    // 都合でクエリ文字列(特にcomeback=true)を削除
    redirectUrl: location.origin + location.pathname,
    clientName: "srdf application"
  });
}

function s_logout() {
  if (auth.getDefaultSession().info.isLoggedIn) {
    console.log("logouting "+auth.getDefaultSession().info.webId+" ...");
    auth.logout();
  } else {
    console.log("You are not logged in.");
  }
}

export { s_login, s_logout };
