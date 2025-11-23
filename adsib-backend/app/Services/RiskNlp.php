<?php

namespace App\Services;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;

class RiskNlp
{
    protected Client $http;

    public function __construct(?string $baseUri = null, ?int $timeout = null)
    {
        // Usa config/services.php → ['risk_nlp' => ['url'=>..., 'timeout'=>...]]
        // o la variable de entorno NLP_API_URL
        $baseUri = rtrim(
            $baseUri ?? (config('services.risk_nlp.url') ?? env('NLP_API_URL', 'http://127.0.0.1:8011')),
            '/'
        );
        $timeout = $timeout ?? (int) (config('services.risk_nlp.timeout') ?? env('NLP_API_TIMEOUT', 8));

        $this->http = new Client([
            'base_uri'    => $baseUri,
            'timeout'     => $timeout,
            'http_errors' => false,
        ]);
    }

    /**
     * Chequeo simple del servicio NLP: GET /health
     */
    public function health(): array
    {
        try {
            $res  = $this->http->get('/health', ['headers' => ['Accept' => 'application/json']]);
            $json = json_decode((string) $res->getBody(), true) ?: [];

            return [
                'ok'     => true,
                'status' => $res->getStatusCode(),
                'data'   => $json,
            ];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Envía el texto al servicio NLP: POST /analyze
     *
     * Devuelve:
     *  - ['ok'=>true, 'data'=>[...]] en éxito
     *  - ['ok'=>false, 'error'=>'...', 'detail'=>'...'] en error
     */
    public function analyze(string $text): array
    {
        $text = (string) $text;

        if (trim($text) === '') {
            return ['ok' => false, 'error' => 'Texto vacío.'];
        }

        try {
            $res = $this->http->post('/analyze', [
                'json'    => ['text' => $text],
                'headers' => ['Accept' => 'application/json'],
            ]);

            $status = $res->getStatusCode();
            $body   = (string) $res->getBody();

            if ($status >= 200 && $status < 300) {
                return [
                    'ok'   => true,
                    'data' => json_decode($body, true),
                ];
            }

            return [
                'ok'    => false,
                'error' => "Servicio devolvió $status",
                'detail'=> $body,
            ];

        } catch (ConnectException $e) {
            return [
                'ok'    => false,
                'error' => 'No se pudo conectar con el servicio NLP',
                'detail'=> $e->getMessage(),
            ];

        } catch (RequestException $e) {
            $code = $e->getResponse() ? $e->getResponse()->getStatusCode() : 500;
            $body = $e->getResponse() ? (string) $e->getResponse()->getBody() : '';

            return [
                'ok'    => false,
                'error' => "Error HTTP ($code)",
                'detail'=> $body ?: $e->getMessage(),
            ];

        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
}