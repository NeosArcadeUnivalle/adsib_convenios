export default function TextInput({ label, ...props }) {
  return (
    <label style={{display:"grid", gap:4}}>
      <span style={{fontSize:12, color:"#374151"}}>{label}</span>
      <input {...props} style={{padding:"6px 8px", border:"1px solid #e5e7eb", borderRadius:8}} />
    </label>
  );
}