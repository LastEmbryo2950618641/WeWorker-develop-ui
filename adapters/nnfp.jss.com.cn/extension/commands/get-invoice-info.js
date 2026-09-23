/* v2 command nnfp.jss.com.cn.get-invoice-info; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("get-invoice-info", async function (params) {
    return window["__nnfp_jss_com_cn_internal"].invoke("nnfp.jss.com.cn.get_invoice_info", params || {});
  });
})();
