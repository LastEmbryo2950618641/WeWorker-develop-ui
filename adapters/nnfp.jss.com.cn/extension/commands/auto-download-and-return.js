/* v2 command nnfp.jss.com.cn.auto-download-and-return; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("auto-download-and-return", async function (params) {
    return window["__nnfp_jss_com_cn_internal"].invoke("nnfp.jss.com.cn.auto_download_and_return", params || {});
  });
})();
