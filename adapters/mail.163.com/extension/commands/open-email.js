/* v2 command mail.163.com.open-email; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("open-email", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.open_email", params || {});
  });
})();
