/* v2 command mail.qq.com.download-attachment; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("download-attachment", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.download_attachment", params || {});
  });
})();
