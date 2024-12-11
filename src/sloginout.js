// SolidのiodcIssuerでログイン・ログアウトの処理をするためのモジュール

//import { solidClientAuthentication } from '@inrupt/solid-client-authn-browser';
const solidClientAuthentication = require('@inrupt/solid-client-authn-browser');

const auth = solidClientAuthentication;

// Solidの認証処理が完了したかどうか
let solid_auth_complete = false;

// 認証の前処理とか必要ならリダイレクトする関数。
// 認証サーバーから、長ーいクエリ文字列付きのURLで
// 帰ってきた時に、それを処理してログイン状態を確定させる
// ような処理をするので、他の何もよりも先に実行されるべき処理。
// このライブラリ限定の話だけど、
// window.SRDF_RESTORE_PREVIOUS_SESSIONをtrueに
// しておくと、一度ログインしていれば、ちょっと
// iodcIssuerにリダイレクトしてすぐにログインした
// ページに戻ってくるようになる。シングルページ
// アプリケーションの時に便利。
async function my_handleIncomingRedirect() {
  if (window.SRDF_RESTORE_PREVIOUS_SESSION) {
    await auth.handleIncomingRedirect({
      restorePreviousSession: true
    });
  } else {
    await auth.handleIncomingRedirect({
      restorePreviousSession: false
    });
  }
  solid_auth_complete = true;
  // s_waitForSolidAuth()関数で待ってる処理を完了させる
  waitingPromiseResolve.forEach(resolve=>{
    resolve();
  });
}

//ページが読み込まれた時に、ここからスタートする。
async function s_init() {
  await my_handleIncomingRedirect(); // ログイン状態の把握の処理
  window.solidFetch = auth.fetch; // solid操作のためのfetchをwindowに保存。
  s_ui_update(); // ログイン状態に応じて、表示、非表示などのコントロール
  s_ui_init(); // 
}
document.addEventListener("DOMContentLoaded",s_init);

// ログイン状態に合せてUIを初期化する処理
async function s_ui_update() {
  const info = auth.getDefaultSession().info;
  if (info.isLoggedIn) {
    await s_ui_logged_in();
  } else {
    s_ui_logged_out();
  }
}

// UIをログイン状態にする．
// (CSSのclassがs_logged_inの物をdisplay: block;にして
//  s_logged_outの物をdisplay: none;にして，s_login_status
//  の物のtextContentにloginの状態を書き込む)
async function s_ui_logged_in() {
  for (let e of document.querySelectorAll(".s_logged_in")) {
    if (e.classList.contains("block"))
      e.style.display = "block";
    else if (e.classList.contains("flex"))
      e.style.display = "flex";
    else if (e.classList.contains("inline"))
      e.style.display = "inline";
    else if (e.classList.contains("inline-block"))
      e.style.display = "inline-block";
    else
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
    if (e.classList.contains("block"))
      e.style.display = "block";
    else if (e.classList.contains("flex"))
      e.style.display = "flex";
    else if (e.classList.contains("inline"))
      e.style.display = "inline";
    else if (e.classList.contains("inline-block"))
      e.style.display = "inline-block";
    else
      e.style.display = "block";
  }
  for (let e of document.querySelectorAll(".s_login_status")) {
    e.textContent = "not logged in";
  }
}

// もし，ページの中にidがsloginoutという<button>とか<div>があったら，
// モーダルでログイン、ログアウトするためのUIを生成して、#sloginoutを
// クリックすることで表示されるようにする。
async function s_ui_init() {
  const sloginout = document.querySelector('#sloginout');
  if (!!sloginout) {
    const info = auth.getDefaultSession().info;
    let login_status;
    if (info.isLoggedIn)
      login_status = "You are logged in as "+info.webId+".";
    else
      login_status = "You are not logged in.";
    const modal_style = document.createElement('style');
    modal_style.textContent = `
#sloginout_auto_modal_div {
  position: fixed;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  opacity: 0;
  visibility: hidden;
  transition: .6s;
}
#sloginout_auto_modal_div.is-show {
  opacity: 1;
  visibility: visible;
}
#sloginout_auto_modal_div .inner {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%,-50%);
  width: 80%;
  max-width: 600px;
  padding: 50px;
  background-color: #fff;
  z-index: 2;
}
#sloginout_auto_modal_div .close-btn {
  position: absolute;
  right: 0;
  top: 0;
  width: 50px;
  height: 50px;
  line-height: 50px;
  text-align: center;
  cursor: pointer;
  font-size: 20px;
  color: #333;
}
#sloginout_auto_modal_div .black-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,.8);
  z-index: 1;
  cursor: pointer;
}
`;
    document.body.appendChild(modal_style);
    const modal_div = document.createElement('div');
    modal_div.setAttribute('id','sloginout_auto_modal_div');
    document.body.appendChild(modal_div);
    //modal_div.insertAdjacentHTML('afterend',`
    modal_div.innerHTML = `
<div class='inner'>
  <div class='close-btn'></div>
  <h1>login logout</h1>
  <!-- <p class='s_login_status'></p> -->
  <p><button class='login_solidweb'>login with solidweb.me</button></p>
  <p><button class='login_solidcommunity'>login with solidcommunity</button></p>
  <p><button class='login_inrupt_nss'>login with inrupt nss</button></p>
  <p>Or other oidcIssuer: <input type='text' class='oidcIssuer'/>
    <button class='login-btn'>login</button></p>
  <p><button class='logout-btn'>logout</button></p>
</div>
<div class='black-bg'></div>
`;
    const close_btn = document.querySelector('#sloginout_auto_modal_div .close-btn');
    const login_display = document.querySelector('#sloginout_auto_modal_div .login-display');
    const login0 = document.querySelector('#sloginout_auto_modal_div .login_solidweb');
    const login1 = document.querySelector('#sloginout_auto_modal_div .login_solidcommunity');
    const login2 = document.querySelector('#sloginout_auto_modal_div .login_inrupt_nss');
    const oidcIssuer = document.querySelector('#sloginout_auto_modal_div .oidcIssuer');
    const login_btn = document.querySelector('#sloginout_auto_modal_div .login-btn');
    const logout_btn = document.querySelector('#sloginout_auto_modal_div .logout-btn');
    const black_bg = document.querySelector('#sloginout_auto_modal_div .black-bg');

    sloginout.addEventListener('click',()=>{modal_div.classList.toggle('is-show');});
    close_btn.addEventListener('click',()=>{modal_div.classList.toggle('is-show');});
    login0.addEventListener('click',async ()=>{await s_login('https://solidweb.me')});
    login1.addEventListener('click',async ()=>{await s_login('https://solidcommunity.net')});
    login2.addEventListener('click',async ()=>{await s_login('https://inrupt.net')});
    login_btn.addEventListener('click',async ()=>{await s_login(oidcIssuer.value);});
    logout_btn.addEventListener('click',()=>{s_logout();modal_div.classList.toggle('is-show');});
    black_bg.addEventListener('click',()=>{modal_div.classList.toggle('is-show');});
  }
}


// SolidのoidcIssuerを指定してログインさせる処理
async function s_login(oidcIssuer) {
  if (!oidcIssuer) {
    console.log("s_login() Error: oidcIssuer is not specifiled.");
    return;
  }
  if (auth.getDefaultSession().info.isLoggedIn) {
    console.log("s_login() Error: You had already logged in.");
    return;
  }
  await auth.login({
    oidcIssuer,
    // 都合でクエリ文字列(特にcomeback=true)を削除
    redirectUrl: location.origin + location.pathname,
    clientName: "srdf application"
  });
}

// ログアウトさせる処理
async function s_logout() {
  if (auth.getDefaultSession().info.isLoggedIn) {
    console.log("logouting "+auth.getDefaultSession().info.webId+" ...");
    await auth.logout();
  } else {
    console.log("You are not logged in.");
  }
  await s_ui_update();
}

// WebIDを文字列で返す。ログインしてない時はnullを返す
async function s_getWebID() {
  const info = auth.getDefaultSession().info;
  if (info.isLoggedIn) {
    return info.webId;
  } else {
    return null;
  }
}

const waitingPromiseResolve = [];
async function s_waitForSolidAuth() {
  if (solid_auth_complete) {
    return;
  } else {
    return new Promise((resolve,reject)=> {
      waitingPromiseResolve.push(resolve);
    });
  }
}

// 念のためInruptのsolid-client-authn-browser全体をエクスポートするため
const ISCA=solidClientAuthentication;
export { s_login, s_logout, s_getWebID, s_waitForSolidAuth, ISCA};
