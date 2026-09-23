/* v2 command jd.com.pay-now; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("pay-now", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.pay_now", params || {});
  });
})();
