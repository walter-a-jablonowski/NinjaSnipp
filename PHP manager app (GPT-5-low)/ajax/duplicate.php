<?php

use App\SnippetManager;

$in = $ctx['input'] ?? [];
$manager = new SnippetManager(__DIR__ . '/..');
$dp = (string)($in['dataPath'] ?? '');
if( $dp !== '' ) $manager->setCurrentDataPath($dp);
$file = (string)($in['file'] ?? '');
if( $file === '' ) throw new Exception('file required');
$res = $manager->duplicate($file, $in['newName'] ?? null);
return [ 'ok' => true ] + $res;
