

inruptのブラウザで認証するためのライブラリのドキュメントの場所。

* <https://docs.inrupt.com/developer-tools/javascript/client-libraries/authentication/>

それからAPI。

* <https://docs.inrupt.com/developer-tools/api/javascript/solid-client-authn-browser/>

inruptの認証ライブラリで一番最初に呼び出しておかないと
いけないhandleIncomingRedirect()なんだけど、非同期の関数で、
この関数を複数の所から同時に呼び出すと上手くいかないっぽい。
(1つ目の呼び出しの返事が帰ってくる前に2つ目の呼び出しをすると
2つ目の呼び出しの方が正しい処理にならない気がする。)
srdfではこの関数呼び出しを'DOMContentLoaded'イベントの
タイミングで自動化しているため、面倒なことに。例えば、
ページが読み込まれたタイミングでWebIDを調べたい時など。
これを解決する方法として、`s_waitForSolidAuth()`
という非同期の関数を用意して、やることにする。
