/* v2 command mail.qq.com.navigate-to-inbox; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("navigate-to-inbox", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.navigate_to_inbox", params || {});
  });
})();
