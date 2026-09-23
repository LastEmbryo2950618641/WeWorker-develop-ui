/* v2 command xiaohongshu.com.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__xiaohongshu_com_internal"].invoke("xiaohongshu.com.check_login_status", params || {});
  });
})();
