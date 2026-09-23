/* v2 command mail.qq.com.download-invoices-by-invoice; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("download-invoices-by-invoice", async function (params) {
    return window["__mail_qq_com_internal"].invoke("mail.qq.com.download_invoices_by_invoice", params || {});
  });
})();
