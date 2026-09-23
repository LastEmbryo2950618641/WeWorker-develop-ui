/* v2 command mail.163.com.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.check_login_status", params || {});
  });
})();
