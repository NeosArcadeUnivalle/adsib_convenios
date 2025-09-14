export default function Alert({ type="info", children }) {
  const colors = {
    info:    { bg:"#eff6ff", br:"#bfdbfe" },
    warn:    { bg:"#fffbeb", br:"#fde68a" },
    danger:  { bg:"#fee2e2", br:"#fecaca" },
    success: { bg:"#dcfce7", br:"#bbf7d0" },
  }[type] || {};
  return (
    <div style={{background:colors.bg,border:`1px solid ${colors.br}`, padding:"8px 10px", borderRadius:8}}>
      {children}
    </div>
  );
}