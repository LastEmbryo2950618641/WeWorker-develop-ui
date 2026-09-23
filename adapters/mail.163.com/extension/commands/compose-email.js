/* v2 command mail.163.com.compose-email; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("compose-email", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.compose_email", params || {});
  });
})();
