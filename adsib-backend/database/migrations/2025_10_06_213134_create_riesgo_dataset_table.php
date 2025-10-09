<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('riesgo_dataset')) {
            Schema::create('riesgo_dataset', function (Blueprint $table) {
                $table->bigIncrements('id');

                // Trazabilidad (nullable por si el fragmento viene de un import externo)
                $table->foreignId('convenio_id')
                    ->nullable()
                    ->constrained('convenios')
                    ->cascadeOnDelete();

                // Tabla correcta: versiones_convenio  ✅
                $table->foreignId('version_id')
                    ->nullable()
                    ->constrained('versiones_convenio')
                    ->cascadeOnDelete();

                // Ubicación en el documento
                $table->integer('page')->nullable();
                $table->integer('line')->nullable();
                $table->integer('start')->nullable(); // offset char
                $table->integer('end')->nullable();   // offset char

                // Fragmento u oración
                $table->longText('text');

                // Etiqueta/severidad (multi-label)
                // En PostgreSQL puedes usar jsonb; si prefieres json puro, cambia a ->json()
                $table->jsonb('label_json')->nullable();

                // Origen de la etiqueta: weak|human|rule|import
                $table->string('source', 20)->default('weak')->index();

                $table->timestamps();

                // Índices auxiliares
                $table->index(['convenio_id', 'version_id']);
                $table->index(['page', 'line']);
            });
        }
    }

    public function down(): void
    {
        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('riesgo_dataset');
        Schema::enableForeignKeyConstraints();
    }
};