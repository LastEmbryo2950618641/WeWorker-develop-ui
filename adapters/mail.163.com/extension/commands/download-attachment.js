/* v2 command mail.163.com.download-attachment; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("download-attachment", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.download_attachment", params || {});
  });
})();
