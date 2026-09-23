/* v2 command jd.com.buy-now; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("buy-now", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.buy_now", params || {});
  });
})();
