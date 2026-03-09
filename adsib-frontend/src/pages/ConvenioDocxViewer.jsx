import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { renderAsync } from "docx-preview";
import api from "../api";
import "./ConvenioDocxViewer.css";

export default function ConvenioDocxViewer() {
  const { id } = useParams();
  const shellRef = useRef(null);
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("Documento");
  const [mode, setMode] = useState("");

  useEffect(() => {
    let active = true;
    const mountNode = containerRef.current;
    let resizeObserver = null;

    const fitDocumentToViewport = () => {
      const shellNode = shellRef.current;
      if (!shellNode || !mountNode) return;

      const shellWidth = shellNode.clientWidth;
      const pageNodes = mountNode.querySelectorAll("section.docx");
      if (!shellWidth || !pageNodes.length) return;

      const horizontalPadding = 0;
      const availableWidth = Math.max(0, shellWidth - horizontalPadding * 2);

      pageNodes.forEach((node) => {
        node.style.zoom = "1";
      });

      pageNodes.forEach((node) => {
        let baseWidth = Number(node.dataset.baseWidth || 0);
        if (!baseWidth) {
          baseWidth =
            Math.ceil(node.getBoundingClientRect().width) ||
            node.scrollWidth ||
            node.offsetWidth ||
            0;
          if (baseWidth > 0) node.dataset.baseWidth = String(baseWidth);
        }
        if (!baseWidth) return;

        const scale = Math.max(0.25, Math.min(1.68, availableWidth / baseWidth));
        node.style.zoom = String(scale);
      });
    };

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        setMode("");

        const [{ data: conv }, res] = await Promise.all([
          api.get(`/convenios/${id}`),
          api.get(`/convenios/${id}/archivo/descargar`, {
            responseType: "arraybuffer",
          }),
        ]);

        if (!active || !mountNode) return;

        const name = (conv?.archivo_nombre_original || "").toLowerCase();
        if (!name.endsWith(".docx")) {
          setError("El archivo base no es DOCX.");
          return;
        }

        setTitle(conv?.archivo_nombre_original || "Documento DOCX");
        mountNode.innerHTML = "";

        const optionsList = [
          {
            label: "alta-fidelidad",
            options: {
              className: "docx",
              ignoreWidth: false,
              ignoreHeight: false,
              ignoreFonts: false,
              inWrapper: true,
              renderHeaders: true,
              renderFooters: true,
              renderFootnotes: true,
              renderEndnotes: true,
              breakPages: true,
              ignoreLastRenderedPageBreak: false,
              experimental: true,
              useBase64URL: true,
            },
          },
          {
            label: "compatibilidad",
            options: {
              className: "docx",
              ignoreWidth: false,
              ignoreHeight: false,
              ignoreFonts: false,
              inWrapper: true,
              renderHeaders: true,
              renderFooters: true,
              renderFootnotes: true,
              renderEndnotes: true,
              breakPages: false,
              ignoreLastRenderedPageBreak: true,
              experimental: false,
              useBase64URL: false,
            },
          },
        ];

        let rendered = false;
        let lastError = null;

        for (const candidate of optionsList) {
          try {
            mountNode.innerHTML = "";
            await renderAsync(res.data, mountNode, mountNode, candidate.options);
            const pageNodes = mountNode.querySelectorAll("section.docx");
            pageNodes.forEach((node) => {
              delete node.dataset.baseWidth;
              node.style.zoom = "1";
            });

            requestAnimationFrame(() => fitDocumentToViewport());
            setTimeout(() => fitDocumentToViewport(), 180);
            setMode(candidate.label);
            rendered = true;
            break;
          } catch (renderErr) {
            lastError = renderErr;
          }
        }

        if (!rendered && lastError) {
          throw lastError;
        }

        if (window.ResizeObserver) {
          resizeObserver = new ResizeObserver(() => fitDocumentToViewport());
          if (shellRef.current) resizeObserver.observe(shellRef.current);
          const wrapperNode = mountNode.querySelector(".docx-wrapper");
          if (wrapperNode) resizeObserver.observe(wrapperNode);
        }
        window.addEventListener("resize", fitDocumentToViewport);
      } catch (e) {
        if (!active) return;
        setError(e?.response?.data?.message || "No se pudo mostrar el DOCX.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener("resize", fitDocumentToViewport);
      if (mountNode) mountNode.innerHTML = "";
    };
  }, [id]);

  return (
    <div className="docx-page">
      <div className="docx-toolbar">
        <div className="docx-toolbar-left">
          <Link to={`/convenios/${id}`} className="docx-back-btn">
            Volver
          </Link>
          <h3 className="docx-title">{title}</h3>
        </div>
      </div>

      {!loading && !error && mode === "compatibilidad" && (
        <div className="docx-notice">
          Vista en modo compatibilidad para este documento.
        </div>
      )}

      {loading && (
        <div className="docx-status">
          Cargando documento...
        </div>
      )}

      {!loading && error && (
        <div className="docx-status docx-status-error">
          {error}
        </div>
      )}

      {!error && (
        <div ref={shellRef} className="docx-viewer-shell">
          <div ref={containerRef} className="docx-viewer-content" />
        </div>
      )}
    </div>
  );
}
