<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;

class AnalisisController extends Controller
{
    public function riesgo(Request $request)
    {
        $text = (string) ($request->input('text') ?? '');

        if (trim($text) === '') {
            return response()->json([
                'message' => 'El texto a analizar está vacío.'
            ], 422);
        }

        $baseUri = rtrim(env('NLP_RISK_BASE', 'http://127.0.0.1:8001'), '/');
        $timeout = (int) env('NLP_RISK_TIMEOUT', 8);

        $client = new Client([
            'base_uri' => $baseUri,
            'timeout'  => $timeout,
            'http_errors' => false, // no lances excepción automática por códigos 4xx/5xx
        ]);

        try {
            $res = $client->post('/analyze', [
                'json' => ['text' => $text],
                'headers' => ['Accept' => 'application/json'],
            ]);

            $status = $res->getStatusCode();
            $body   = (string) $res->getBody();

            // Si el microservicio devolvió 200-299, retornamos tal cual.
            if ($status >= 200 && $status < 300) {
                $json = json_decode($body, true);
                return response()->json($json ?? [], 200);
            }

            // Si fue error controlado del microservicio, propagamos con mensaje claro
            return response()->json([
                'message' => 'El servicio de análisis devolvió un error.',
                'detail'  => $body,
                'status'  => $status,
            ], $status);

        } catch (ConnectException $e) {
            // No se pudo conectar (tu caso: cURL error 7)
            return response()->json([
                'message' => 'No se pudo conectar con el servicio de análisis de riesgo.',
                'detail'  => $e->getMessage(),
                'service' => $baseUri . '/analyze',
            ], 503);

        } catch (RequestException $e) {
            $code = $e->getResponse() ? $e->getResponse()->getStatusCode() : 500;
            $body = $e->getResponse() ? (string) $e->getResponse()->getBody() : '';
            return response()->json([
                'message' => 'Error al solicitar el análisis de riesgo.',
                'detail'  => $body ?: $e->getMessage(),
            ], $code ?: 500);

        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Error inesperado en el análisis.',
                'detail'  => $e->getMessage(),
            ], 500);
        }
    }
}