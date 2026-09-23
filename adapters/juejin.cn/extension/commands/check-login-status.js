/* v2 command juejin.cn.check-login-status; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("check-login-status", async function (params) {
    return window["__juejin_cn_internal"].invoke("juejin.cn.check_login_status", params || {});
  });
})();
