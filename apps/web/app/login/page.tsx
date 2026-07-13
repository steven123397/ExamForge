import { LoginForm } from "../../features/auth/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell" id="main-content" tabIndex={-1}>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">EF</div>
          <div>
            <strong>ExamForge</strong>
            <span>排考控制面</span>
          </div>
        </div>
        <div className="login-heading">
          <p className="eyebrow">身份验证</p>
          <h1 id="login-title">登录工作区</h1>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
