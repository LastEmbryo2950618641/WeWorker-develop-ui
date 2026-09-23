/* v2 command bilibili.com.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.check_login_status", params || {});
  });
})();
