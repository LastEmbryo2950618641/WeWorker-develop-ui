/* v2 command jd.com.open-product; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("open-product", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.open_product", params || {});
  });
})();
