/* v2 command jd.com.navigate-to-homepage; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("navigate-to-homepage", async function (params) {
    return window["__jd_com_internal"].invoke("jd.com.navigate_to_homepage", params || {});
  });
})();
