/* v2 command jd.com.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.check_login_status", params || {});
  });
})();
