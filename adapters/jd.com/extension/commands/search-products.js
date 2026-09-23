/* v2 command jd.com.search-products; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("search-products", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.search_products", params || {});
  });
})();
