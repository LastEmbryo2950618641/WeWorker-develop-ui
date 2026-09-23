/* v2 command mail.163.com.get-current-page-info; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("get-current-page-info", async function (params) {
    return window["__mail_163_com_internal"].invoke("mail.163.com.get_current_page_info", params || {});
  });
})();
