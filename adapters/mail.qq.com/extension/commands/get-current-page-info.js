/* v2 command mail.qq.com.get-current-page-info; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("get-current-page-info", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.get_current_page_info", params || {});
  });
})();
