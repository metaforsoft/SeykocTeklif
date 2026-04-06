const loginFormEl = document.getElementById("loginForm");
const usernameInputEl = document.getElementById("usernameInput");
const passwordInputEl = document.getElementById("passwordInput");
const loginErrorEl = document.getElementById("loginError");

async function loginRequest(username, password) {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Giriş başarısız");
  }
  return data;
}

loginFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = String(usernameInputEl?.value || "").trim();
  const password = String(passwordInputEl?.value || "");
  loginErrorEl?.classList.add("hidden");

  try {
    await loginRequest(username, password);
    window.location.href = "/app/dashboard";
  } catch (error) {
    loginErrorEl.textContent = error instanceof Error ? error.message : "Giriş başarısız";
    loginErrorEl.classList.remove("hidden");
  }
});
