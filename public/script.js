// Find the button on the page
var exploreBtn = document.getElementById("exploreBtn");

// When the button is clicked, scroll down to the About section
exploreBtn.addEventListener("click", function () {
  document.getElementById("about").scrollIntoView();
});

/* ==========================================================================
   Shared helpers
   ========================================================================== */

var API = {
  /** Returns the parsed JSON body and the HTTP status for every response. */
  request: function (method, url, body) {
    var options = {
      method: method,
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    };

    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    return fetch(url, options).then(function (response) {
      return response.json()
        .catch(function () { return {}; })
        .then(function (data) {
          return { status: response.status, ok: response.ok, data: data };
        });
    });
  },
  get: function (url) { return API.request("GET", url); },
  post: function (url, body) { return API.request("POST", url, body); }
};

// "1350" -> "Rs.1,350" with the rupee sign and Indian digit grouping
function formatPrice(amount) {
  return "₹" + Number(amount).toLocaleString("en-IN");
}

function setFieldError(input, errorBox, message) {
  if (errorBox) errorBox.textContent = message || "";
  if (!input) return;

  if (message) {
    input.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
  } else {
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
  }
}

/* ==========================================================================
   Site content - headings, copy and contact details come from the CMS.
   The markup already holds the same text, so the page reads correctly even
   before this resolves (or if the server is unreachable).
   ========================================================================== */
(function () {
  API.get("/api/content").then(function (result) {
    if (!result.ok || !result.data.content) return;
    var content = result.data.content;

    document.querySelectorAll("[data-content]").forEach(function (el) {
      var value = content[el.getAttribute("data-content")];
      if (typeof value === "string" && value !== "") el.textContent = value;
    });

    if (content.site_title) document.title = content.site_title;

    var emailLink = document.getElementById("contactEmailLink");
    if (emailLink && content.contact_email) {
      emailLink.textContent = content.contact_email;
      emailLink.setAttribute("href", "mailto:" + content.contact_email);
    }

    var phoneLink = document.getElementById("contactPhoneLink");
    if (phoneLink && content.contact_phone) {
      phoneLink.textContent = content.contact_phone;
      // tel: links need the digits and a leading +, without spaces
      phoneLink.setAttribute("href", "tel:" + content.contact_phone.replace(/[^\d+]/g, ""));
    }
  }).catch(function () {
    /* Offline: the markup's own copy stays on screen. */
  });
})();

/* ==========================================================================
   Order form - menu and prices come from the database, and a placed order is
   stored there too. The server is the authority on the price and the total.
   ========================================================================== */
(function () {
  var form = document.getElementById("orderForm");
  if (!form) return;

  var nameInput = document.getElementById("customerName");
  var productSelect = document.getElementById("product");
  var qtyInput = document.getElementById("quantity");
  var totalOut = document.getElementById("orderTotal");
  var submitBtn = document.getElementById("placeOrderBtn");
  var menuGrid = document.getElementById("menuGrid");

  var nameError = document.getElementById("customerNameError");
  var qtyError = document.getElementById("quantityError");
  var productError = document.getElementById("productError");
  var formError = document.getElementById("orderFormError");

  var summary = document.getElementById("orderSummary");
  var hint = document.getElementById("orderHint");
  var summaryMessage = document.getElementById("summaryMessage");
  var summaryReference = document.getElementById("summaryReference");
  var summaryName = document.getElementById("summaryName");
  var summaryProduct = document.getElementById("summaryProduct");
  var summaryQty = document.getElementById("summaryQuantity");
  var summaryTotal = document.getElementById("summaryTotal");

  // Price for the live preview. The server recalculates it on submit.
  function unitPrice() {
    var option = productSelect.options[productSelect.selectedIndex];
    var price = option ? parseInt(option.getAttribute("data-price"), 10) : NaN;
    return isNaN(price) ? 0 : price;
  }

  // 0 when the box is empty or holds anything but a whole number >= 1
  function quantity() {
    var raw = qtyInput.value.trim();
    if (!/^\d+$/.test(raw)) return 0;
    var qty = parseInt(raw, 10);
    return qty >= 1 ? qty : 0;
  }

  function updateTotal() {
    totalOut.textContent = formatPrice(unitPrice() * quantity());
  }

  /* ---- render the menu and the dropdown from the database ---------------- */

  function renderMenu(products) {
    if (!menuGrid) return;
    menuGrid.textContent = "";

    products.forEach(function (product) {
      var card = document.createElement("article");
      card.className = "menu-card";

      var art = document.createElement("div");
      art.className = "menu-card-art";
      art.setAttribute("aria-hidden", "true");
      var artSpan = document.createElement("span");
      artSpan.textContent = product.emoji || "\u{1F370}";
      art.appendChild(artSpan);

      var body = document.createElement("div");
      body.className = "menu-card-body";

      var top = document.createElement("div");
      top.className = "menu-card-top";
      var heading = document.createElement("h3");
      heading.textContent = product.name;
      var price = document.createElement("span");
      price.className = "price";
      price.textContent = formatPrice(product.price);
      top.appendChild(heading);
      top.appendChild(price);

      var description = document.createElement("p");
      description.textContent = product.description || "";

      body.appendChild(top);
      body.appendChild(description);
      card.appendChild(art);
      card.appendChild(body);
      menuGrid.appendChild(card);
    });
  }

  function renderOptions(products) {
    var previous = productSelect.value;
    productSelect.textContent = "";

    products.forEach(function (product) {
      var option = document.createElement("option");
      option.value = String(product.id);          // the API wants the id
      option.setAttribute("data-price", product.price);
      option.setAttribute("data-name", product.name);
      option.textContent = product.name + " — " + formatPrice(product.price);
      productSelect.appendChild(option);
    });

    // Keep the shopper's choice across a refresh where we can
    var match = Array.prototype.filter.call(productSelect.options, function (o) {
      return o.value === previous || o.getAttribute("data-name") === previous;
    })[0];
    if (match) productSelect.value = match.value;

    updateTotal();
  }

  function loadProducts() {
    return API.get("/api/products").then(function (result) {
      if (!result.ok || !result.data.products || result.data.products.length === 0) return;
      renderMenu(result.data.products);
      renderOptions(result.data.products);
    }).catch(function () {
      /* Offline: the hand-written cards and options stay in place. */
    });
  }

  /* ---- live total -------------------------------------------------------- */

  productSelect.addEventListener("change", updateTotal);
  qtyInput.addEventListener("input", function () {
    updateTotal();
    if (quantity() > 0) setFieldError(qtyInput, qtyError, "");
  });
  qtyInput.addEventListener("change", updateTotal);

  nameInput.addEventListener("input", function () {
    if (nameInput.value.trim() !== "") setFieldError(nameInput, nameError, "");
  });

  /* ---- submit ------------------------------------------------------------ */

  function showSummary(order) {
    summaryMessage.textContent =
      "Thank you, " + order.customerName + "! Your order is with the bakery and " +
      "the oven is warm. Please collect it at the counter.";
    summaryReference.textContent = "#" + order.id;
    summaryName.textContent = order.customerName;
    summaryProduct.textContent = order.productName + " (" + formatPrice(order.unitPrice) + " each)";
    summaryQty.textContent = String(order.quantity);
    summaryTotal.textContent = formatPrice(order.total);

    if (hint) hint.hidden = true;
    summary.hidden = false;
    summary.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var customer = nameInput.value.trim();
    var qty = quantity();
    var firstInvalid = null;

    setFieldError(null, formError, "");

    // Check in the browser first so obvious mistakes never need a round trip.
    if (customer === "") {
      setFieldError(nameInput, nameError, "Please enter your name.");
      firstInvalid = firstInvalid || nameInput;
    } else {
      setFieldError(nameInput, nameError, "");
    }

    if (qty < 1) {
      setFieldError(qtyInput, qtyError, "Quantity must be a whole number of at least 1.");
      firstInvalid = firstInvalid || qtyInput;
    } else {
      setFieldError(qtyInput, qtyError, "");
    }

    if (firstInvalid) {
      summary.hidden = true;
      if (hint) hint.hidden = false;
      firstInvalid.focus();
      return;
    }

    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Placing order...";

    API.post("/api/orders", {
      customerName: customer,
      productId: productSelect.value,
      quantity: qty
    }).then(function (result) {
      if (result.ok && result.data.order) {
        showSummary(result.data.order);
        return;
      }

      // The server rejected it: show its messages against the same fields.
      summary.hidden = true;
      if (hint) hint.hidden = false;

      var errors = result.data.errors || {};
      if (errors.customerName) setFieldError(nameInput, nameError, errors.customerName);
      if (errors.quantity) setFieldError(qtyInput, qtyError, errors.quantity);
      if (errors.product) setFieldError(productSelect, productError, errors.product);

      if (!errors.customerName && !errors.quantity && !errors.product) {
        setFieldError(null, formError,
          result.data.error || "Sorry, we could not place that order. Please try again.");
      }

      // A deleted or deactivated product means our list is stale.
      if (errors.product) loadProducts();
    }).catch(function () {
      summary.hidden = true;
      if (hint) hint.hidden = false;
      setFieldError(null, formError,
        "We could not reach the bakery just now, so the order was not placed. " +
        "Please check your connection and try again.");
    }).then(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    });
  });

  loadProducts();
  updateTotal();
})();

/* ==========================================================================
   Contact form - validated here and again on the server, then stored so the
   bakery can read it in the admin area.
   ========================================================================== */
(function () {
  var form = document.getElementById("contactForm");
  if (!form) return;

  var submitBtn = document.getElementById("sendMessageBtn");
  var formError = document.getElementById("contactFormError");
  var confirmBox = document.getElementById("contactConfirm");

  var fields = [
    {
      key: "name",
      input: document.getElementById("contactName"),
      error: document.getElementById("contactNameError"),
      check: function (value) {
        return value === "" ? "Please enter your name." : "";
      }
    },
    {
      key: "email",
      input: document.getElementById("contactEmail"),
      error: document.getElementById("contactEmailError"),
      check: function (value) {
        if (value === "") return "Please enter your email address.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return "Please enter a valid email address.";
        }
        return "";
      }
    },
    {
      key: "message",
      input: document.getElementById("contactMessage"),
      error: document.getElementById("contactMessageError"),
      check: function (value) {
        return value === "" ? "Please write a short message." : "";
      }
    }
  ];

  fields.forEach(function (field) {
    if (!field.input || !field.error) return;
    field.input.addEventListener("input", function () {
      if (field.check(field.input.value.trim()) === "") {
        setFieldError(field.input, field.error, "");
      }
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var firstInvalid = null;
    setFieldError(null, formError, "");

    fields.forEach(function (field) {
      if (!field.input || !field.error) return;
      var message = field.check(field.input.value.trim());
      setFieldError(field.input, field.error, message);
      if (message && !firstInvalid) firstInvalid = field.input;
    });

    if (firstInvalid) {
      confirmBox.hidden = true;
      firstInvalid.focus();
      return;
    }

    var name = fields[0].input.value.trim();

    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Sending...";

    API.post("/api/messages", {
      name: name,
      email: fields[1].input.value.trim(),
      message: fields[2].input.value.trim()
    }).then(function (result) {
      if (result.ok) {
        confirmBox.textContent =
          "Thanks, " + name + "! Your message is with the bakery and we usually " +
          "reply within a day.";
        confirmBox.hidden = false;
        form.reset();
        return;
      }

      confirmBox.hidden = true;
      var errors = result.data.errors || {};
      var handled = false;

      fields.forEach(function (field) {
        if (errors[field.key]) {
          setFieldError(field.input, field.error, errors[field.key]);
          handled = true;
        }
      });

      if (!handled) {
        setFieldError(null, formError,
          result.data.error || "Sorry, we could not send that message. Please try again.");
      }
    }).catch(function () {
      confirmBox.hidden = true;
      setFieldError(null, formError,
        "We could not reach the bakery just now, so your message was not sent. " +
        "Please check your connection and try again.");
    }).then(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    });
  });
})();
