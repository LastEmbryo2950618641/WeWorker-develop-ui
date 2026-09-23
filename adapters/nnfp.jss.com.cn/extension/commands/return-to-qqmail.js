/* v2 command nnfp.jss.com.cn.return-to-qqmail; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("return-to-qqmail", async function (params) {
    return window["__nnfp_jss_com_cn_internal"].invoke("nnfp.jss.com.cn.return_to_qqmail", params || {});
  });
})();
