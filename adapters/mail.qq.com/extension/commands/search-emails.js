/* v2 command mail.qq.com.search-emails; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("search-emails", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.search_emails", params || {});
  });
})();
