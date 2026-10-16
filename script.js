// Find the button on the page
var exploreBtn = document.getElementById("exploreBtn");

// When the button is clicked, scroll down to the About section
exploreBtn.addEventListener("click", function () {
  document.getElementById("about").scrollIntoView();
});
