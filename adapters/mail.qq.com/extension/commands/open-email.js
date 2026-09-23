/* v2 command mail.qq.com.open-email; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("open-email", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.open_email", params || {});
  });
})();
