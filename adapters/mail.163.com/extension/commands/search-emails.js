/* v2 command mail.163.com.search-emails; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("search-emails", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.search_emails", params || {});
  });
})();
