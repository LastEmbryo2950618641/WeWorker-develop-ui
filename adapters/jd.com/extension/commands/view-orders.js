/* v2 command jd.com.view-orders; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("view-orders", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.view_orders", params || {});
  });
})();
