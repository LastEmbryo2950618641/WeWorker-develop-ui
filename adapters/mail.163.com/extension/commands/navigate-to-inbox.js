/* v2 command mail.163.com.navigate-to-inbox; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("navigate-to-inbox", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.navigate_to_inbox", params || {});
  });
})();
