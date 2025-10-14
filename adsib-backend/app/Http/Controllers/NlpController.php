<?php
 
namespace App\Services;
 
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
 
class NlpRiskClient
{
    protected Client $http;
    protected string $baseUrl;
    protected int $timeout;
 
    public function __construct()
    {
        // Usa config/services.php si existe; si no, lee directo de env
        $this->baseUrl = config('services.nlp_risk.url', env('NLP_RISK_URL', 'http://localhost:8001'));
        $this->timeout = (int) config('services.nlp_risk.timeout', (int) env('NLP_RISK_TIMEOUT', 10));
 
        $this->http = new Client([
            'base_uri' => rtrim($this->baseUrl, '/') . '/',
            'timeout'  => $this->timeout,
        ]);
    }
 
    /**
     * Envía texto al microservicio de riesgo.
     * Estructura esperada de respuesta (ejemplo):
     * { ok: true, data: { risk_level, score, matches: [...], summary: {...} } }
     */
    public function analyze(string $text): array
    {
        try {
            $resp = $this->http->post('analyze', [
                'json' => ['text' => $text],
                'headers' => ['Accept' => 'application/json'],
            ]);
 
            $json = json_decode((string) $resp->getBody(), true);
 
            // Normalizamos por si el servicio devuelve otro formato
            if (!is_array($json)) {
                return ['ok' => false, 'error' => 'Respuesta no válida del servicio NLP'];
            }
            // Si tu servicio Python retorna directamente {ok,data,...}, lo devolvemos tal cual:
            if (array_key_exists('ok', $json)) {
                return $json;
            }
 
            // Fallback: envolver en el formato esperado por tu backend
            return ['ok' => true, 'data' => $json];
        } catch (GuzzleException $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
}