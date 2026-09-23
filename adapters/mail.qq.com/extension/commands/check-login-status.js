/* v2 command mail.qq.com.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.check_login_status", params || {});
  });
})();
