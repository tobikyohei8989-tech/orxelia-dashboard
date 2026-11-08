"use strict";
// Recovery is isolated: no workspace reads/writes, session storage or background sync.
(async () => {
  const endpoint = "https://yzlxcfncdtojajlhihap.supabase.co/auth/v1";
  const apikey = "sb_publishable_T9287hFW7tudpePLIu9c_w_9xsxTujp";
  const status = document.getElementById("status");
  const passwordForm = document.getElementById("password-form");
  const emailForm = document.getElementById("email-form");
  const params = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  let token = params.get("type") === "recovery" ? params.get("access_token") : null;
  const hadError = params.has("error") || params.has("error_code") || query.has("error");
  // Remove credentials immediately; retain the access token in memory only.
  history.replaceState(null,"",location.pathname);
  async function auth(path, body, bearer) {
    const response = await fetch(endpoint + path, {
      method: body ? (path === "/user" ? "PUT" : "POST") : "GET",
      headers: {apikey,"Content-Type":"application/json",...(bearer ? {Authorization:"Bearer " + bearer} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), cache:"no-store",referrerPolicy:"no-referrer"
    });
    if (!response.ok) {
      let code = "";
      try { code = (await response.json()).code || ""; } catch {}
      const error = new Error("認証処理に失敗しました"); error.code = code; error.status = response.status; throw error;
    }
    return response;
  }
  function expired() {
    token = null; passwordForm.hidden = true; emailForm.hidden = false;
    status.textContent = "認証リンクが無効か、有効期限が切れています。新しい再設定メールを送ってください。";
  }
  if (token) {
    try { await auth("/user",null,token); passwordForm.hidden = false; status.textContent = "本人確認ができました。新しいパスワードを入力してください。"; }
    catch { expired(); }
  } else {
    emailForm.hidden = false;
    status.textContent = hadError || query.has("code") ? "認証リンクを確認できませんでした。この画面から新しい再設定メールを送ってください。" : "登録メールアドレスに再設定リンクを送ります。メール内のリンクから新しいパスワードを設定できます。";
  }
  passwordForm.addEventListener("submit",async event => {
    event.preventDefault();
    if (!token) return expired();
    const password = passwordForm.elements.password.value;
    if (password.length < 12 || password !== passwordForm.elements.confirm.value) {
      status.textContent = "12文字以上で、確認用と同じパスワードを入力してください。"; return;
    }
    const button = passwordForm.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await auth("/user",{password},token);
      token = null; passwordForm.reset(); passwordForm.hidden = true;
      status.textContent = "パスワードを更新しました。ダッシュボードに戻り、新しいパスワードでログインしてください。";
    } catch (error) {
      if (error.status === 401 || error.status === 403) expired();
      else status.textContent = error.status === 429 ? "しばらく待ってからもう一度お試しください。" : "更新できませんでした。別のパスワードを指定するか、新しい再設定メールでお試しください。";
    } finally { passwordForm.reset(); button.disabled = false; }
  });
  emailForm.addEventListener("submit",async event => {
    event.preventDefault();
    const button = emailForm.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      // An exact, allow-listed callback; no dashboard boot or automatic cloud sync.
      const redirect = new URL("reset-password.html",location.href).href;
      await auth("/recover?redirect_to="+encodeURIComponent(redirect),{email:emailForm.elements.email.value.trim()});
      status.textContent = "再設定メールをリクエストしました。受信箱と迷惑メールを確認し、最新のメール内のリンクを開いてください。";
    } catch (error) { status.textContent = error.status === 429 ? "Supabaseのメール送信上限に達しています。時間をおいて再送してください。すでに届いている最新のメールも確認してください。" : "メールを送れませんでした。時間をおいてもう一度お試しください。"; }
    finally { button.disabled = false; }
  });
})();
