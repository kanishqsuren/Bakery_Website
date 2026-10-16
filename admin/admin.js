"use strict";

/* ==========================================================================
   SweetCrumbs Admin CMS - vanilla JS, talks to /api/admin.

   Everything that renders data from the database goes through textContent,
   never innerHTML, so a customer's name or message can never inject markup
   into this page.
   ========================================================================== */

var $ = function (id) { return document.getElementById(id); };

var state = {
  admin: null,
  tab: "dashboard",
  products: [],
  orders: [],
  messages: [],
  content: {},
  orderFilter: ""
};

/* ------------------------------------------------------------------ api -- */

var api = {
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
      return response.json().catch(function () { return {}; }).then(function (data) {
        // Session expired while the tab sat open: drop back to the login screen.
        if (response.status === 401 && state.admin && url.indexOf("/login") === -1) {
          state.admin = null;
          showLogin("Your session expired. Please sign in again.");
        }
        return { status: response.status, ok: response.ok, data: data };
      });
    });
  },
  get: function (u) { return api.request("GET", u); },
  post: function (u, b) { return api.request("POST", u, b); },
  put: function (u, b) { return api.request("PUT", u, b); },
  patch: function (u, b) { return api.request("PATCH", u, b); },
  del: function (u) { return api.request("DELETE", u); }
};

/* ---------------------------------------------------------------- utils -- */

function money(amount) {
  return "₹" + Number(amount || 0).toLocaleString("en-IN");
}

/** SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; show it in local time. */
function formatDate(value) {
  if (!value) return "";
  var iso = String(value).replace(" ", "T") + "Z";
  var date = new Date(iso);
  if (isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clear(node) { if (node) node.textContent = ""; }

var toastTimer = null;
function toast(message, isError) {
  var box = $("toast");
  box.textContent = message;
  box.className = "toast" + (isError ? " is-error" : "");
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.hidden = true; }, 2800);
}

function setError(inputId, message) {
  var input = $(inputId);
  var box = $(inputId + "Error");
  if (box) box.textContent = message || "";
  if (!input) return;
  if (message) input.classList.add("invalid");
  else input.classList.remove("invalid");
}

function emptyRow(tbody, columns, message) {
  var tr = el("tr");
  var td = el("td", "empty", message);
  td.colSpan = columns;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

/* ------------------------------------------------------------- login UI -- */

function showLogin(message) {
  $("app").hidden = true;
  $("loginScreen").hidden = false;
  $("loginError").textContent = message || "";
  var username = $("username");
  if (username) username.focus();
}

function showApp() {
  $("loginScreen").hidden = true;
  $("app").hidden = false;
  $("whoami").textContent = "Signed in as " + state.admin.username;
}

$("loginForm").addEventListener("submit", function (event) {
  event.preventDefault();

  var button = $("loginBtn");
  var label = button.textContent;
  button.disabled = true;
  button.textContent = "Signing in...";
  $("loginError").textContent = "";

  api.post("/api/admin/login", {
    username: $("username").value,
    password: $("password").value
  }).then(function (result) {
    if (result.ok && result.data.admin) {
      state.admin = result.data.admin;
      $("password").value = "";
      showApp();
      selectTab("dashboard");
      return;
    }
    $("loginError").textContent = result.data.error || "Could not sign in.";
  }).catch(function () {
    $("loginError").textContent = "Could not reach the server. Is it running?";
  }).then(function () {
    button.disabled = false;
    button.textContent = label;
  });
});

$("logoutBtn").addEventListener("click", function () {
  api.post("/api/admin/logout").then(function () {
    state.admin = null;
    showLogin("You have been signed out.");
  });
});

/* ---------------------------------------------------------------- tabs --- */

function selectTab(name) {
  state.tab = name;

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.classList.toggle("is-active", tab.getAttribute("data-tab") === name);
  });
  document.querySelectorAll("[data-panel]").forEach(function (panel) {
    panel.hidden = panel.getAttribute("data-panel") !== name;
  });

  if (name === "dashboard") loadDashboard();
  if (name === "products") loadProducts();
  if (name === "orders") loadOrders();
  if (name === "messages") loadMessages();
  if (name === "content") loadContent();
}

$("tabs").addEventListener("click", function (event) {
  var tab = event.target.closest(".tab");
  if (tab) selectTab(tab.getAttribute("data-tab"));
});

/* ----------------------------------------------------------- dashboard -- */

function renderStats(stats) {
  var grid = $("statGrid");
  clear(grid);

  [
    { label: "New orders", value: stats.newOrders, note: stats.orders + " in total" },
    { label: "Unread messages", value: stats.unreadMessages, note: stats.messages + " in total" },
    { label: "Products live", value: stats.activeProducts, note: stats.products + " on file" },
    { label: "Order value", value: money(stats.revenue), note: "excluding cancelled" }
  ].forEach(function (item) {
    var card = el("div", "stat");
    card.appendChild(el("span", "stat-label", item.label));
    card.appendChild(el("span", "stat-value", item.value));
    card.appendChild(el("span", "stat-note", item.note));
    grid.appendChild(card);
  });

  var ordersBadge = $("ordersBadge");
  ordersBadge.textContent = stats.newOrders;
  ordersBadge.hidden = stats.newOrders === 0;

  var messagesBadge = $("messagesBadge");
  messagesBadge.textContent = stats.unreadMessages;
  messagesBadge.hidden = stats.unreadMessages === 0;
}

function statusPill(status) {
  return el("span", "pill pill-" + status, status);
}

function loadDashboard() {
  api.get("/api/admin/stats").then(function (result) {
    if (result.ok) renderStats(result.data.stats);
  });

  api.get("/api/admin/orders").then(function (result) {
    if (!result.ok) return;
    var tbody = $("recentOrders");
    clear(tbody);

    var recent = result.data.orders.slice(0, 8);
    if (recent.length === 0) {
      emptyRow(tbody, 7, "No orders yet. They will appear here as soon as one is placed.");
      return;
    }

    recent.forEach(function (order) {
      var tr = el("tr");
      tr.appendChild(el("td", "cell-muted", "#" + order.id));
      tr.appendChild(el("td", "cell-strong", order.customer_name));
      tr.appendChild(el("td", null, order.product_name));
      tr.appendChild(el("td", "num", order.quantity));
      tr.appendChild(el("td", "num cell-strong", money(order.total)));
      var statusCell = el("td");
      statusCell.appendChild(statusPill(order.status));
      tr.appendChild(statusCell);
      tr.appendChild(el("td", "cell-muted", formatDate(order.created_at)));
      tbody.appendChild(tr);
    });
  });
}

/* ------------------------------------------------------------ products -- */

function loadProducts() {
  return api.get("/api/admin/products").then(function (result) {
    if (!result.ok) return;
    state.products = result.data.products;
    renderProducts();
  });
}

function renderProducts() {
  var tbody = $("productRows");
  clear(tbody);

  if (state.products.length === 0) {
    emptyRow(tbody, 7, "No products yet. Use Add Product to create the first one.");
    return;
  }

  state.products.forEach(function (product, index) {
    var tr = el("tr");

    var moveCell = el("td");
    var moves = el("div", "move-btns");
    var up = el("button", null, "↑");
    up.type = "button";
    up.title = "Move up";
    up.disabled = index === 0;
    up.addEventListener("click", function () { reorder(product.id, "up"); });

    var down = el("button", null, "↓");
    down.type = "button";
    down.title = "Move down";
    down.disabled = index === state.products.length - 1;
    down.addEventListener("click", function () { reorder(product.id, "down"); });

    moves.appendChild(up);
    moves.appendChild(down);
    moveCell.appendChild(moves);
    tr.appendChild(moveCell);

    tr.appendChild(el("td", "cell-emoji", product.emoji || ""));
    tr.appendChild(el("td", "cell-strong", product.name));
    tr.appendChild(el("td", "num cell-strong", money(product.price)));
    tr.appendChild(el("td", "cell-desc", product.description || ""));

    var statusCell = el("td");
    statusCell.appendChild(
      product.active
        ? el("span", "pill pill-collected", "live")
        : el("span", "pill pill-hidden", "hidden")
    );
    tr.appendChild(statusCell);

    var actions = el("td", "actions-col");
    var wrap = el("div", "row-actions");

    var edit = el("button", "mini ghost", "Edit");
    edit.type = "button";
    edit.addEventListener("click", function () { openProductModal(product); });

    var toggle = el("button", "mini ghost", product.active ? "Hide" : "Show");
    toggle.type = "button";
    toggle.addEventListener("click", function () {
      saveProduct(product.id, {
        name: product.name,
        price: product.price,
        description: product.description,
        emoji: product.emoji,
        active: !product.active
      }, true);
    });

    var remove = el("button", "mini danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", function () {
      confirmDialog(
        "Delete " + product.name + "?",
        "It disappears from the website straight away. Past orders keep their own copy of the name and price.",
        function () {
          api.del("/api/admin/products/" + product.id).then(function (result) {
            if (result.ok) { toast("Product deleted."); loadProducts(); }
            else toast(result.data.error || "Could not delete.", true);
          });
        }
      );
    });

    wrap.appendChild(edit);
    wrap.appendChild(toggle);
    wrap.appendChild(remove);
    actions.appendChild(wrap);
    tr.appendChild(actions);

    tbody.appendChild(tr);
  });
}

function reorder(id, direction) {
  api.post("/api/admin/products/reorder", { id: id, direction: direction }).then(function (result) {
    if (result.ok) loadProducts();
    else toast(result.data.error || "Could not reorder.", true);
  });
}

var editingProductId = null;

function openProductModal(product) {
  editingProductId = product ? product.id : null;

  $("productModalTitle").textContent = product ? "Edit Product" : "Add Product";
  $("pName").value = product ? product.name : "";
  $("pPrice").value = product ? product.price : "";
  $("pEmoji").value = product ? (product.emoji || "") : "";
  $("pDescription").value = product ? (product.description || "") : "";
  $("pActive").checked = product ? Boolean(product.active) : true;

  setError("pName", "");
  setError("pPrice", "");
  $("productFormError").textContent = "";

  $("productModal").hidden = false;
  $("pName").focus();
}

function closeProductModal() {
  $("productModal").hidden = true;
  editingProductId = null;
}

$("newProductBtn").addEventListener("click", function () { openProductModal(null); });

$("productForm").addEventListener("submit", function (event) {
  event.preventDefault();

  saveProduct(editingProductId, {
    name: $("pName").value,
    price: $("pPrice").value,
    description: $("pDescription").value,
    emoji: $("pEmoji").value,
    active: $("pActive").checked
  }, false);
});

function saveProduct(id, payload, quiet) {
  var request = id
    ? api.put("/api/admin/products/" + id, payload)
    : api.post("/api/admin/products", payload);

  var button = $("productSaveBtn");
  if (!quiet) button.disabled = true;

  return request.then(function (result) {
    if (result.ok) {
      if (!quiet) closeProductModal();
      toast(id ? "Product saved." : "Product added.");
      loadProducts();
      return;
    }

    var errors = result.data.errors || {};
    if (quiet) {
      toast(errors.name || errors.price || result.data.error || "Could not save.", true);
      return;
    }

    setError("pName", errors.name || "");
    setError("pPrice", errors.price || "");
    if (!errors.name && !errors.price) {
      $("productFormError").textContent = result.data.error || "Could not save this product.";
    }
  }).catch(function () {
    if (!quiet) $("productFormError").textContent = "Could not reach the server.";
    else toast("Could not reach the server.", true);
  }).then(function () {
    button.disabled = false;
  });
}

/* -------------------------------------------------------------- orders -- */

$("orderFilters").addEventListener("click", function (event) {
  var chip = event.target.closest(".chip");
  if (!chip) return;

  state.orderFilter = chip.getAttribute("data-status") || "";
  document.querySelectorAll("#orderFilters .chip").forEach(function (c) {
    c.classList.toggle("is-active", c === chip);
  });
  loadOrders();
});

function loadOrders() {
  var url = "/api/admin/orders" + (state.orderFilter ? "?status=" + encodeURIComponent(state.orderFilter) : "");

  return api.get(url).then(function (result) {
    if (!result.ok) return;
    state.orders = result.data.orders;
    renderOrders();
  });
}

function renderOrders() {
  var tbody = $("orderRows");
  clear(tbody);

  if (state.orders.length === 0) {
    emptyRow(tbody, 8, state.orderFilter
      ? "No orders with that status."
      : "No orders yet. Place one on the website to see it here.");
    return;
  }

  state.orders.forEach(function (order) {
    var tr = el("tr");
    tr.appendChild(el("td", "cell-muted", "#" + order.id));
    tr.appendChild(el("td", "cell-strong", order.customer_name));
    tr.appendChild(el("td", null, order.product_name));
    tr.appendChild(el("td", "num", order.quantity));
    tr.appendChild(el("td", "num cell-strong", money(order.total)));

    var statusCell = el("td");
    var select = el("select");
    ["new", "preparing", "collected", "cancelled"].forEach(function (status) {
      var option = el("option", null, status);
      option.value = status;
      if (order.status === status) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      api.patch("/api/admin/orders/" + order.id, { status: select.value }).then(function (result) {
        if (result.ok) { toast("Order #" + order.id + " is now " + select.value + "."); loadOrders(); }
        else toast(result.data.error || "Could not update.", true);
      });
    });
    statusCell.appendChild(select);
    tr.appendChild(statusCell);

    tr.appendChild(el("td", "cell-muted", formatDate(order.created_at)));

    var actions = el("td", "actions-col");
    var wrap = el("div", "row-actions");
    var remove = el("button", "mini danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", function () {
      confirmDialog("Delete order #" + order.id + "?", "This removes it from the records for good.", function () {
        api.del("/api/admin/orders/" + order.id).then(function (result) {
          if (result.ok) { toast("Order deleted."); loadOrders(); }
          else toast(result.data.error || "Could not delete.", true);
        });
      });
    });
    wrap.appendChild(remove);
    actions.appendChild(wrap);
    tr.appendChild(actions);

    tbody.appendChild(tr);
  });
}

/* ------------------------------------------------------------ messages -- */

function loadMessages() {
  return api.get("/api/admin/messages").then(function (result) {
    if (!result.ok) return;
    state.messages = result.data.messages;
    renderMessages();
  });
}

function renderMessages() {
  var list = $("messageList");
  clear(list);

  if (state.messages.length === 0) {
    var empty = el("div", "table-wrap");
    empty.appendChild(el("p", "empty", "No messages yet. The contact form on the website feeds this list."));
    list.appendChild(empty);
    return;
  }

  state.messages.forEach(function (message) {
    var card = el("div", "message-card" + (message.is_read ? "" : " is-unread"));

    var head = el("div", "message-head");
    var from = el("div", "message-from");
    from.appendChild(document.createTextNode(message.name + " · "));
    var mail = el("a", null, message.email);
    mail.href = "mailto:" + message.email;
    from.appendChild(mail);
    head.appendChild(from);
    head.appendChild(el("span", "message-date", formatDate(message.created_at)));
    card.appendChild(head);

    card.appendChild(el("p", "message-body", message.message));

    var actions = el("div", "message-actions");

    var toggle = el("button", "mini ghost", message.is_read ? "Mark unread" : "Mark read");
    toggle.type = "button";
    toggle.addEventListener("click", function () {
      api.patch("/api/admin/messages/" + message.id, { isRead: !message.is_read }).then(function (result) {
        if (result.ok) { loadMessages(); refreshBadges(); }
        else toast("Could not update.", true);
      });
    });

    var replyBtn = el("button", "mini ghost", "Reply by email");
    replyBtn.type = "button";
    replyBtn.addEventListener("click", function () {
      window.location.href = "mailto:" + encodeURIComponent(message.email) +
        "?subject=" + encodeURIComponent("Re: your message to SweetCrumbs Bakery");
    });

    var remove = el("button", "mini danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", function () {
      confirmDialog("Delete this message?", "From " + message.name + ". This cannot be undone.", function () {
        api.del("/api/admin/messages/" + message.id).then(function (result) {
          if (result.ok) { toast("Message deleted."); loadMessages(); refreshBadges(); }
          else toast("Could not delete.", true);
        });
      });
    });

    actions.appendChild(toggle);
    actions.appendChild(replyBtn);
    actions.appendChild(remove);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

function refreshBadges() {
  api.get("/api/admin/stats").then(function (result) {
    if (result.ok) renderStats(result.data.stats);
  });
}

/* ------------------------------------------------------------- content -- */

var CONTENT_LABELS = {
  site_title: "Site title",
  hero_heading: "Hero heading",
  hero_text: "Hero paragraph",
  hero_button: "Hero button label",
  about_heading: "About heading",
  about_text: "About paragraph",
  menu_heading: "Menu heading",
  menu_text: "Menu paragraph",
  order_heading: "Order heading",
  order_text: "Order paragraph",
  order_note: "Order footnote",
  contact_heading: "Contact heading",
  contact_text: "Contact paragraph",
  contact_note: "Contact footnote",
  bakery_name: "Bakery name",
  contact_email: "Email address",
  contact_phone: "Phone number",
  contact_address: "Address",
  contact_hours: "Opening hours",
  footer_text: "Footer line"
};

var CONTENT_ORDER = Object.keys(CONTENT_LABELS);

function loadContent() {
  return api.get("/api/admin/content").then(function (result) {
    if (!result.ok) return;
    state.content = result.data.content;
    renderContent();
  });
}

function renderContent() {
  var form = $("contentForm");
  clear(form);

  var keys = Object.keys(state.content).sort(function (a, b) {
    var ia = CONTENT_ORDER.indexOf(a), ib = CONTENT_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  keys.forEach(function (key) {
    var value = state.content[key];
    var wrap = el("div", "content-field");

    var label = el("label", null, CONTENT_LABELS[key] || key);
    label.setAttribute("for", "content_" + key);
    wrap.appendChild(label);

    // Long copy gets a textarea, short labels get a single-line input.
    var input = value.length > 70 ? el("textarea") : el("input");
    if (input.tagName === "TEXTAREA") input.rows = 3;
    else input.type = "text";

    input.id = "content_" + key;
    input.value = value;
    input.setAttribute("data-key", key);
    wrap.appendChild(input);

    wrap.appendChild(el("span", "key", key));
    form.appendChild(wrap);
  });
}

$("saveContentBtn").addEventListener("click", function () {
  var updates = {};
  document.querySelectorAll("#contentForm [data-key]").forEach(function (input) {
    updates[input.getAttribute("data-key")] = input.value;
  });

  var button = $("saveContentBtn");
  button.disabled = true;

  api.put("/api/admin/content", { content: updates }).then(function (result) {
    if (result.ok) toast("Saved " + result.data.saved + " content fields.");
    else toast(result.data.error || "Could not save.", true);
  }).catch(function () {
    toast("Could not reach the server.", true);
  }).then(function () {
    button.disabled = false;
  });
});

$("contentForm").addEventListener("submit", function (event) { event.preventDefault(); });

/* ------------------------------------------------------------ settings -- */

$("passwordForm").addEventListener("submit", function (event) {
  event.preventDefault();

  setError("currentPassword", "");
  setError("newPassword", "");
  $("passwordOk").hidden = true;

  api.post("/api/admin/password", {
    currentPassword: $("currentPassword").value,
    newPassword: $("newPassword").value
  }).then(function (result) {
    if (result.ok) {
      $("currentPassword").value = "";
      $("newPassword").value = "";
      $("passwordOk").hidden = false;
      toast("Password updated.");
      return;
    }
    var errors = result.data.errors || {};
    setError("currentPassword", errors.currentPassword || "");
    setError("newPassword", errors.newPassword || "");
    if (!errors.currentPassword && !errors.newPassword) {
      toast(result.data.error || "Could not update the password.", true);
    }
  });
});

/* ------------------------------------------------------------- dialogs -- */

var confirmAction = null;

function confirmDialog(title, text, onConfirm) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  confirmAction = onConfirm;
  $("confirmModal").hidden = false;
  $("confirmOkBtn").focus();
}

$("confirmOkBtn").addEventListener("click", function () {
  var action = confirmAction;
  confirmAction = null;
  $("confirmModal").hidden = true;
  if (action) action();
});

// Any element marked data-close shuts the modal it sits in.
document.addEventListener("click", function (event) {
  var closer = event.target.closest("[data-close]");
  if (!closer) return;
  var modal = closer.closest(".modal");
  if (!modal) return;
  modal.hidden = true;
  if (modal.id === "productModal") editingProductId = null;
  if (modal.id === "confirmModal") confirmAction = null;
});

document.addEventListener("keydown", function (event) {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".modal").forEach(function (modal) { modal.hidden = true; });
  confirmAction = null;
});

/* ---------------------------------------------------------------- boot -- */

api.get("/api/admin/me").then(function (result) {
  if (result.ok && result.data.admin) {
    state.admin = result.data.admin;
    showApp();
    selectTab("dashboard");
  } else {
    showLogin("");
  }
}).catch(function () {
  showLogin("Could not reach the server. Is it running?");
});
