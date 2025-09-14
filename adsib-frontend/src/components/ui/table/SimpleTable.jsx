export default function SimpleTable({ head = [], children }) {
  return (
    <table width="100%" cellPadding={6} style={{ borderCollapse:"collapse" }}>
      <thead>
        <tr>{head.map((h,i)=><th key={i} style={{textAlign: h.align || "left"}}>{h.label || h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}