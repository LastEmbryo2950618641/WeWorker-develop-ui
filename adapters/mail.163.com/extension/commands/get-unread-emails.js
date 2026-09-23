/* v2 command mail.163.com.get-unread-emails; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("get-unread-emails", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.get_unread_emails", params || {});
  });
})();
