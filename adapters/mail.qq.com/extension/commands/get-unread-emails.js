/* v2 command mail.qq.com.get-unread-emails; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("get-unread-emails", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.get_unread_emails", params || {});
  });
})();
