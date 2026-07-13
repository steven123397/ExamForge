import { StatusPage } from "../components/shared/status-page";

export default function NotFoundPage() {
  return (
    <StatusPage
      code="404"
      title="页面不存在"
      detail="请求的页面或实体不存在。"
      href="/"
      actionLabel="返回工作区"
    />
  );
}
