import { AuthApi, AuthApiError } from "../auth/AuthApi";
import type { AuthSession } from "../auth/types";

type AuthMode = "login" | "register";

const ERROR_COPY: Record<string, string> = {
  INVALID_CREDENTIALS: "Nieprawidłowy adres e-mail lub hasło.",
  INVALID_EMAIL: "Wpisz poprawny adres e-mail.",
  INVALID_PASSWORD_LENGTH: "Hasło musi mieć od 12 do 128 znaków.",
  EMAIL_TAKEN: "Konto z tym adresem e-mail już istnieje.",
  INVALID_ORIGIN: "Ta strona nie ma dostępu do serwera gry.",
  NETWORK_ERROR: "Nie można połączyć się z serwerem. Spróbuj ponownie.",
  TOO_MANY_REQUESTS: "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.",
};

export class AuthScreen {
  private mode: AuthMode = "login";
  private readonly api = new AuthApi();
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly email: HTMLInputElement;
  private readonly password: HTMLInputElement;
  private readonly confirmation: HTMLInputElement;
  private readonly confirmationField: HTMLElement;
  private readonly error: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly submitLabel: HTMLElement;
  private readonly tabs: HTMLButtonElement[];

  private constructor() {
    const app = document.getElementById("app");
    const boot = document.getElementById("boot-screen");
    if (!app || !boot) throw new Error("Brakuje kontenera interfejsu gry.");
    boot.hidden = true;

    this.root = document.createElement("section");
    this.root.className = "auth-screen";
    this.root.setAttribute("aria-label", "Dostęp do Runeveil");
    this.root.innerHTML = `
      <div class="auth-screen__backdrop" aria-hidden="true"></div>
      <div class="auth-screen__grain" aria-hidden="true"></div>
      <div class="auth-screen__veil" aria-hidden="true"></div>
      <main class="auth-shell">
        <header class="auth-brand">
          <p class="auth-brand__mark">Kroniki pogranicza</p>
          <h1 class="auth-brand__title">Runeveil</h1>
          <p class="auth-brand__motto">Tam, gdzie zasłona staje się cienka.</p>
        </header>
        <section class="auth-panel" aria-labelledby="auth-title">
          <div class="auth-tabs" role="tablist" aria-label="Rodzaj dostępu">
            <button class="auth-tabs__tab auth-tabs__tab--active" type="button" role="tab" aria-selected="true" data-auth-mode="login">Wejście</button>
            <button class="auth-tabs__tab" type="button" role="tab" aria-selected="false" data-auth-mode="register">Nowe konto</button>
          </div>
          <header class="auth-panel__header">
            <h2 id="auth-title">Powrót</h2>
            <p id="auth-description">Wpisz pieczęć i wróć na drogę.</p>
          </header>
          <form class="auth-form" novalidate>
            <label class="auth-field">
              <span>E-mail</span>
              <input name="email" type="email" autocomplete="email" maxlength="254" placeholder="twoj@list.pl" required />
            </label>
            <label class="auth-field">
              <span>Hasło</span>
              <span class="auth-field__password">
                <input name="password" type="password" autocomplete="current-password" maxlength="128" required />
                <button class="auth-field__reveal" type="button" aria-label="Pokaż hasło" aria-pressed="false">Pokaż</button>
              </span>
            </label>
            <label class="auth-field auth-field--confirmation" hidden>
              <span>Powtórz hasło</span>
              <input name="confirmation" type="password" autocomplete="new-password" maxlength="128" />
            </label>
            <p class="auth-form__hint" hidden>Minimum 12 znaków — lepiej długa fraza niż krótkie hasło.</p>
            <div class="auth-form__error" role="alert" aria-live="polite" hidden></div>
            <button class="auth-form__submit" type="submit">
              <span class="auth-form__submit-label">Wejdź</span>
              <span class="auth-form__spinner" aria-hidden="true"></span>
            </button>
          </form>
        </section>
      </main>`;
    app.append(this.root);

    this.form = this.required(".auth-form", HTMLFormElement);
    this.email = this.required('input[name="email"]', HTMLInputElement);
    this.password = this.required('input[name="password"]', HTMLInputElement);
    this.confirmation = this.required(
      'input[name="confirmation"]',
      HTMLInputElement,
    );
    this.confirmationField = this.required(".auth-field--confirmation");
    this.error = this.required(".auth-form__error");
    this.submit = this.required(".auth-form__submit", HTMLButtonElement);
    this.submitLabel = this.required(".auth-form__submit-label");
    this.tabs = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("[data-auth-mode]"),
    );
    this.bindEvents();
  }

  static async authenticate(): Promise<AuthSession> {
    const screen = new AuthScreen();
    return screen.run();
  }

  private async run(): Promise<AuthSession> {
    this.setBusy(true, "Sprawdzanie…");
    try {
      const session = await this.api.session();
      if (session) return this.complete(session);
    } catch (error) {
      this.showError(error);
    } finally {
      this.setBusy(false);
    }
    this.email.focus();
    return new Promise<AuthSession>((resolve) => {
      this.form.addEventListener("auth:complete", (event) => {
        resolve((event as CustomEvent<AuthSession>).detail);
      });
    });
  }

  private bindEvents(): void {
    for (const tab of this.tabs) {
      tab.addEventListener("click", () => {
        const mode = tab.dataset.authMode;
        if (mode === "login" || mode === "register") this.setMode(mode);
      });
    }
    const reveal = this.required(".auth-field__reveal", HTMLButtonElement);
    reveal.addEventListener("click", () => {
      const showing = this.password.type === "text";
      this.password.type = showing ? "password" : "text";
      reveal.textContent = showing ? "Pokaż" : "Ukryj";
      reveal.setAttribute("aria-pressed", String(!showing));
      reveal.setAttribute(
        "aria-label",
        showing ? "Pokaż hasło" : "Ukryj hasło",
      );
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitCredentials();
    });
  }

  private setMode(mode: AuthMode): void {
    this.mode = mode;
    this.hideError();
    const registering = mode === "register";
    this.confirmationField.hidden = !registering;
    this.confirmation.required = registering;
    this.password.autocomplete = registering
      ? "new-password"
      : "current-password";
    this.required(".auth-form__hint", HTMLElement).hidden = !registering;
    this.required("#auth-title").textContent = registering
      ? "Pierwsza wyprawa"
      : "Powrót";
    this.required("#auth-description").textContent = registering
      ? "Załóż konto i stań na progu zasłony."
      : "Wpisz pieczęć i wróć na drogę.";
    this.submitLabel.textContent = registering ? "Utwórz konto" : "Wejdź";
    for (const tab of this.tabs) {
      const selected = tab.dataset.authMode === mode;
      tab.classList.toggle("auth-tabs__tab--active", selected);
      tab.setAttribute("aria-selected", String(selected));
    }
  }

  private async submitCredentials(): Promise<void> {
    this.hideError();
    const email = this.email.value.trim();
    const password = this.password.value;
    if (!this.email.validity.valid) {
      this.showMessage("Wpisz poprawny adres e-mail.");
      this.email.focus();
      return;
    }
    if (this.mode === "register" && password.length < 12) {
      this.showMessage("Hasło musi mieć co najmniej 12 znaków.");
      this.password.focus();
      return;
    }
    if (this.mode === "register" && password !== this.confirmation.value) {
      this.showMessage("Podane hasła nie są takie same.");
      this.confirmation.focus();
      return;
    }

    this.setBusy(
      true,
      this.mode === "register" ? "Tworzenie…" : "Otwieranie…",
    );
    try {
      const session =
        this.mode === "register"
          ? await this.api.register(email, password)
          : await this.api.login(email, password);
      const completedSession = this.complete(session);
      this.form.dispatchEvent(
        new CustomEvent<AuthSession>("auth:complete", {
          detail: completedSession,
        }),
      );
    } catch (error) {
      this.showError(error);
      this.setBusy(false);
    }
  }

  private complete(session: AuthSession): AuthSession {
    this.root.remove();
    return session;
  }

  private setBusy(busy: boolean, label?: string): void {
    this.submit.disabled = busy;
    this.root.classList.toggle("auth-screen--busy", busy);
    for (const tab of this.tabs) tab.disabled = busy;
    this.email.disabled = busy;
    this.password.disabled = busy;
    this.confirmation.disabled = busy;
    if (label) this.submitLabel.textContent = label;
    else
      this.submitLabel.textContent =
        this.mode === "register" ? "Utwórz konto" : "Wejdź";
  }

  private showError(error: unknown): void {
    const code = error instanceof AuthApiError ? error.code : "REQUEST_FAILED";
    const message =
      error instanceof AuthApiError && error.status === 429
        ? ERROR_COPY.TOO_MANY_REQUESTS
        : (ERROR_COPY[code] ??
          (error instanceof Error
            ? error.message
            : "Nie udało się wykonać operacji. Spróbuj ponownie."));
    this.showMessage(message);
  }

  private showMessage(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
  }

  private hideError(): void {
    this.error.hidden = true;
    this.error.textContent = "";
  }

  private required<T extends Element>(
    selector: string,
    constructor?: { new (): T },
  ): T {
    const element = this.root.querySelector(selector);
    if (!element || (constructor && !(element instanceof constructor))) {
      throw new Error(`Brakuje elementu interfejsu: ${selector}`);
    }
    return element as T;
  }
}
