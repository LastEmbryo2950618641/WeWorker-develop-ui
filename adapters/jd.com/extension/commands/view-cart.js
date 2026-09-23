/* v2 command jd.com.view-cart; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("view-cart", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.view_cart", params || {});
  });
})();
